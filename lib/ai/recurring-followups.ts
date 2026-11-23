import type { assistantRecurringSchedules } from "@/db/schema";
import { hashStructuredInput } from "./service";
import { dispatchAssistantRun } from "./agent-runs";

export type RecurringSchedule = typeof assistantRecurringSchedules.$inferSelect;

// These predicates use trusted SQL aliases only, never request input.
export function scheduleAccessSql(alias: string) {
  return `EXISTS (SELECT 1 FROM users u JOIN workspace_memberships m ON m.user_id = u.id AND m.status = 'active'
    JOIN clients c ON c.workspace_id = m.workspace_id AND c.id = ${alias}.client_id AND c.status = 'active'
    JOIN recovery_cases rc ON rc.id = ${alias}.case_id AND rc.workspace_id = m.workspace_id AND rc.client_id = c.id AND rc.deleted_at IS NULL
    JOIN assistant_conversations a ON a.id = ${alias}.conversation_id AND a.workspace_id = m.workspace_id AND a.client_id = c.id AND a.user_id = u.id
    JOIN users reviewer ON reviewer.id = ${alias}.approved_by_user_id AND reviewer.status = 'active'
    JOIN workspace_memberships permission ON permission.user_id = reviewer.id AND permission.workspace_id = m.workspace_id AND permission.status = 'active' AND permission.role IN ('admin','practitioner','reviewer')
    WHERE u.id = ${alias}.user_id AND u.status = 'active' AND m.workspace_id = ${alias}.workspace_id AND m.role IN ('admin','practitioner','reviewer','analyst'))`;
}

export function recurringRunPermissionSql(alias: string) {
  return `(${alias}.recurring_schedule_id IS NULL OR EXISTS (SELECT 1 FROM assistant_recurring_schedules permission_schedule
    WHERE permission_schedule.id = ${alias}.recurring_schedule_id AND permission_schedule.status = 'active'
    AND permission_schedule.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${scheduleAccessSql("permission_schedule")}))`;
}

export function scheduleEvent(d1: D1Database, id: string, type: string, payload: unknown, key: string, now = new Date().toISOString()) {
  return d1.prepare(`INSERT OR IGNORE INTO assistant_schedule_events (event_key,schedule_id,workspace_id,client_id,event_type,payload_json,created_at)
    SELECT ?,id,workspace_id,client_id,?,?,? FROM assistant_recurring_schedules WHERE id = ?`)
    .bind(`${id}:${key}`, type, JSON.stringify(payload), now, id);
}

export function dueOccurrence(schedule: Pick<RecurringSchedule, "startsAt" | "everyDays" | "nextRunAt" | "endsAt">, now: number) {
  if (!schedule.nextRunAt || Date.parse(schedule.nextRunAt) > now || now >= Date.parse(schedule.endsAt)) return null;
  const interval = schedule.everyDays * 86_400_000;
  const slot = Math.floor((now - Date.parse(schedule.startsAt)) / interval);
  const at = Date.parse(schedule.startsAt) + slot * interval;
  const next = at + interval;
  return { at: new Date(at).toISOString(), next: next < Date.parse(schedule.endsAt) ? new Date(next).toISOString() : null,
    skipped: Math.max(0, Math.round((at - Date.parse(schedule.nextRunAt)) / interval)) };
}

export function cancelScheduleStatements(d1: D1Database, id: string, now: string, actorUserId: string, reason: string) {
  const guard = `recurring_schedule_id = ? AND status = 'canceled' AND completed_at = ?`;
  return [
    d1.prepare(`UPDATE assistant_agent_runs SET status='canceled',error_message=?,completed_at=?,updated_at=? WHERE recurring_schedule_id=? AND status IN ('queued','running')
      AND EXISTS (SELECT 1 FROM assistant_recurring_schedules WHERE id=? AND status <> 'active')`).bind(reason,now,now,id,id),
    d1.prepare(`UPDATE assistant_messages SET metadata_json=json_set(metadata_json,'$.backgroundRun.status','canceled','$.error',?) WHERE id IN (SELECT assistant_message_id FROM assistant_agent_runs WHERE ${guard})`).bind(reason,id,now),
    d1.prepare(`UPDATE ai_jobs SET status='failed',validation_outcome='rejected',error_code='PERMISSION_REVOKED',error_message=?,completed_at=? WHERE status='processing' AND id IN (SELECT id FROM assistant_agent_runs WHERE ${guard})`).bind(reason,now,id,now),
    d1.prepare(`INSERT OR IGNORE INTO assistant_run_events (event_key,run_id,workspace_id,client_id,event_type,payload_json,created_at)
      SELECT id || ':canceled',id,workspace_id,client_id,'canceled',?,? FROM assistant_agent_runs WHERE ${guard}`).bind(JSON.stringify({ scheduleId:id, actorUserId, reason }),now,id,now),
  ];
}

/** Cron materialises one current occurrence per permission; missed slots never burst. */
export async function tickRecurringSchedules(bindings: Pick<Env,"DB"|"ASSISTANT_WORKFLOW">, clock = Date.now()) {
  const d1 = bindings.DB;
  const now = new Date(clock).toISOString();
  const invalid = await d1.prepare(`SELECT id,ends_at FROM assistant_recurring_schedules s WHERE s.status='active' AND (s.ends_at <= ? OR NOT ${scheduleAccessSql("s")}) LIMIT 10`).bind(now).all<{id:string;ends_at:string}>();
  for (const schedule of invalid.results) {
    const status = schedule.ends_at <= now ? "expired" : "suspended";
    await d1.batch([
      d1.prepare(`UPDATE assistant_recurring_schedules SET status=?,next_run_at=NULL,updated_at=? WHERE id=? AND status='active'
        AND ${status === "expired" ? "ends_at <= ?" : `ends_at > ? AND NOT ${scheduleAccessSql("assistant_recurring_schedules")}`}`).bind(status,now,schedule.id,now),
      d1.prepare(`INSERT OR IGNORE INTO assistant_schedule_events (event_key,schedule_id,workspace_id,client_id,event_type,payload_json,created_at)
        SELECT ?,id,workspace_id,client_id,?,?,? FROM assistant_recurring_schedules WHERE id=? AND status=? AND updated_at=?`).bind(`${schedule.id}:${status}`,status,JSON.stringify({reason:status === "expired" ? "Permission expired" : "Requester, approver or case access changed"}),now,schedule.id,status,now),
      ...cancelScheduleStatements(d1,schedule.id,now,"system",`Recurring permission ${status}.`),
    ]);
  }
  const due = await d1.prepare(`SELECT id,workspace_id AS workspaceId,client_id AS clientId,conversation_id AS conversationId,user_id AS userId,case_id AS caseId,
    question,starts_at AS startsAt,every_days AS everyDays,ends_at AS endsAt,next_run_at AS nextRunAt FROM assistant_recurring_schedules s
    WHERE s.status='active' AND s.next_run_at <= ? AND s.ends_at > ? AND ${scheduleAccessSql("s")} ORDER BY s.next_run_at,s.id LIMIT 10`).bind(now,now).all<RecurringSchedule>();
  for (const schedule of due.results) {
    const occurrence = dueOccurrence(schedule,clock);
    if (!occurrence) continue;
    const hash = await hashStructuredInput({ scheduleId:schedule.id, at:occurrence.at });
    const runId = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
    const guard = "id=? AND status='active' AND last_occurrence_id=?";
    const args = [schedule.id,runId];
    const metadata = JSON.stringify({ backgroundRun:{ id:runId,status:"queued",scheduledFor:occurrence.at,scheduleId:schedule.id },activity:[{id:"queued",kind:"status",label:"Recurring follow-up queued",state:"running"}] });
    const batch = await d1.batch([
      d1.prepare(`UPDATE assistant_recurring_schedules SET next_run_at=?,last_occurrence_id=?,updated_at=? WHERE id=? AND status='active' AND next_run_at=? AND ${scheduleAccessSql("assistant_recurring_schedules")}`).bind(occurrence.next,runId,now,schedule.id,schedule.nextRunAt),
      d1.prepare(`INSERT INTO assistant_messages (conversation_id,role,content,metadata_json,created_at) SELECT conversation_id,'user',?,?,? FROM assistant_recurring_schedules WHERE ${guard}
        AND NOT EXISTS (SELECT 1 FROM assistant_agent_runs WHERE id=?)`).bind(`Approved recurring follow-up: ${schedule.question}`,JSON.stringify({runRequestId:runId,scheduleId:schedule.id}),now,...args,runId),
      d1.prepare(`INSERT INTO assistant_messages (conversation_id,role,content,metadata_json,ai_job_id,created_at) SELECT conversation_id,'assistant','',?,?,? FROM assistant_recurring_schedules WHERE ${guard}
        AND NOT EXISTS (SELECT 1 FROM assistant_agent_runs WHERE id=?)`).bind(metadata,runId,now,...args,runId),
      d1.prepare(`INSERT OR IGNORE INTO assistant_agent_runs (id,workspace_id,client_id,conversation_id,user_id,user_message_id,assistant_message_id,question,case_id,scheduled_for,recurring_schedule_id,created_at,updated_at)
        SELECT ?,workspace_id,client_id,conversation_id,user_id,
          (SELECT id FROM assistant_messages WHERE conversation_id=s.conversation_id AND role='user' AND json_extract(metadata_json,'$.runRequestId')=? LIMIT 1),
          (SELECT id FROM assistant_messages WHERE conversation_id=s.conversation_id AND role='assistant' AND ai_job_id=? LIMIT 1),question,case_id,?,id,?,?
        FROM assistant_recurring_schedules s WHERE ${guard}`).bind(runId,runId,runId,occurrence.at,now,now,...args),
      d1.prepare(`INSERT OR IGNORE INTO assistant_run_events (event_key,run_id,workspace_id,client_id,event_type,payload_json,created_at)
        SELECT id || ':scheduled',id,workspace_id,client_id,'recurring_scheduled',?,? FROM assistant_agent_runs WHERE id=?`).bind(JSON.stringify({scheduleId:schedule.id,scheduledFor:occurrence.at}),now,runId),
      d1.prepare(`INSERT OR IGNORE INTO assistant_schedule_events (event_key,schedule_id,workspace_id,client_id,event_type,payload_json,created_at)
        SELECT ?,recurring_schedule_id,workspace_id,client_id,'occurrence_queued',?,? FROM assistant_agent_runs WHERE id=? AND recurring_schedule_id=?`).bind(`${schedule.id}:occurrence-${occurrence.at}`,JSON.stringify({runId,scheduledFor:occurrence.at,skippedMissedOccurrences:occurrence.skipped}),now,runId,schedule.id),
    ]);
    if (batch[0].meta.changes) await dispatchAssistantRun(bindings,runId);
  }
}
