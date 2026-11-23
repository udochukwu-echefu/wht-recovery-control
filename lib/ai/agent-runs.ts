import { getD1 } from "@/db";
import type { assistantAgentRuns } from "@/db/schema";
import { ApiError, type RequestContext } from "@/lib/auth";
import { recurringRunPermissionSql } from "./recurring-followups";

export const assistantRunRoles = ["admin", "practitioner", "reviewer", "analyst"] as const;
export type RunScope = { id: string; workspaceId: string; clientId: string };

export function runEventStatement(d1: D1Database, run: RunScope, eventType: string, payload: unknown, eventKey: string, attempt = 0) {
  return d1.prepare(`INSERT OR IGNORE INTO assistant_run_events
    (event_key, run_id, workspace_id, client_id, attempt, event_type, payload_json, created_at)
    SELECT ?, id, workspace_id, client_id, ?, ?, ?, ? FROM assistant_agent_runs
    WHERE id = ? AND workspace_id = ? AND client_id = ?`)
    .bind(`${run.id}:${eventKey}`, attempt, eventType, JSON.stringify(payload), new Date().toISOString(), run.id, run.workspaceId, run.clientId);
}

/** Re-resolve identity at wake, before tools, and before publication. */
export async function runContext(run: typeof assistantAgentRuns.$inferSelect): Promise<RequestContext> {
  const identity = await getD1().prepare(`SELECT u.id AS user_id, u.provider_subject, u.email, u.display_name,
    w.id AS workspace_id, w.name AS workspace_name, m.role
    FROM users u JOIN workspace_memberships m ON m.user_id = u.id AND m.status = 'active'
    JOIN workspaces w ON w.id = m.workspace_id
    JOIN clients c ON c.workspace_id = w.id AND c.id = ? AND c.status = 'active'
    JOIN assistant_conversations a ON a.id = ? AND a.workspace_id = w.id AND a.client_id = c.id AND a.user_id = u.id
    WHERE u.id = ? AND w.id = ? AND u.status = 'active'
    AND (? IS NULL OR EXISTS (SELECT 1 FROM recovery_cases rc WHERE rc.id = ? AND rc.workspace_id = w.id AND rc.client_id = c.id AND rc.deleted_at IS NULL)) LIMIT 1`)
    .bind(run.clientId, run.conversationId, run.userId, run.workspaceId, run.caseId, run.caseId)
    .first<{ user_id: string; provider_subject: string; email: string; display_name: string; workspace_id: string; workspace_name: string; role: string }>();
  if (!identity || !(assistantRunRoles as readonly string[]).includes(identity.role)) throw new ApiError(403, "The requester no longer has access to this investigation.");
  const permission = await getD1().prepare(`SELECT id FROM assistant_agent_runs WHERE id=? AND ${recurringRunPermissionSql("assistant_agent_runs")}`).bind(run.id).first();
  if (!permission) throw new ApiError(403,"The recurring follow-up permission is no longer active.");
  return {
    user: { id: identity.user_id, providerSubject: identity.provider_subject, email: identity.email, displayName: identity.display_name },
    workspace: { id: identity.workspace_id, name: identity.workspace_name, role: identity.role as RequestContext["workspace"]["role"] },
    clientId: run.clientId,
    localDevelopment: false,
  };
}

export async function failRun(d1: D1Database, run: RunScope, message: string) {
  const now = new Date().toISOString();
  await d1.batch([
    d1.prepare(`UPDATE assistant_agent_runs SET status = 'failed', error_message = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND workspace_id = ? AND client_id = ? AND status IN ('queued', 'running')`)
      .bind(message, now, now, run.id, run.workspaceId, run.clientId),
    d1.prepare(`UPDATE assistant_messages SET metadata_json = json_set(metadata_json, '$.backgroundRun.status', 'failed', '$.error', ?)
      WHERE id = (SELECT assistant_message_id FROM assistant_agent_runs WHERE id = ? AND workspace_id = ? AND client_id = ? AND status = 'failed')`)
      .bind(message, run.id, run.workspaceId, run.clientId),
    d1.prepare(`UPDATE ai_jobs SET status = 'failed', validation_outcome = 'rejected', error_message = ?, completed_at = ?
      WHERE id = ? AND workspace_id = ? AND client_id = ? AND status = 'processing'
      AND EXISTS (SELECT 1 FROM assistant_agent_runs WHERE id = ? AND status = 'failed')`)
      .bind(message, now, run.id, run.workspaceId, run.clientId, run.id),
    d1.prepare(`INSERT OR IGNORE INTO assistant_run_events (event_key, run_id, workspace_id, client_id, event_type, payload_json, created_at)
      SELECT ?, id, workspace_id, client_id, 'failed', ?, ? FROM assistant_agent_runs
      WHERE id = ? AND workspace_id = ? AND client_id = ? AND status = 'failed'`)
      .bind(`${run.id}:failed`, JSON.stringify({ message }), now, run.id, run.workspaceId, run.clientId),
  ]);
}

/** Queued D1 rows are an outbox. A deterministic instance ID handles uncertain creates. */
export async function dispatchAssistantRun(bindings: Pick<Env, "DB" | "ASSISTANT_WORKFLOW">, runId: string) {
  const d1 = bindings.DB;
  const run = await d1.prepare(`SELECT id, workspace_id AS workspaceId, client_id AS clientId, dispatch_attempts AS attempts
    FROM assistant_agent_runs WHERE id = ? AND status = 'queued' AND dispatched_at IS NULL AND dispatch_attempts < 3`)
    .bind(runId).first<RunScope & { attempts: number }>();
  if (!run) return;
  const claim = await d1.prepare(`UPDATE assistant_agent_runs SET dispatch_attempts = dispatch_attempts + 1
    WHERE id = ? AND status = 'queued' AND dispatched_at IS NULL AND dispatch_attempts = ?`)
    .bind(runId, run.attempts).run();
  if (!claim.meta.changes) return;
  try {
    try { await bindings.ASSISTANT_WORKFLOW.create({ id: runId, params: { runId } }); }
    catch (error) {
      // A create can succeed while its response is lost. Verify that instance;
      // never create a second ID or claim a terminal instance is still running.
      const status = await (await bindings.ASSISTANT_WORKFLOW.get(runId)).status();
      if (status.status === "errored" || status.status === "terminated") throw error;
    }
    await d1.batch([
      d1.prepare("UPDATE assistant_agent_runs SET dispatched_at = ? WHERE id = ? AND dispatched_at IS NULL")
        .bind(new Date().toISOString(), runId),
      runEventStatement(d1, run, "dispatched", { instanceId: runId }, "dispatched"),
    ]);
    const latest = await d1.prepare("SELECT status FROM assistant_agent_runs WHERE id = ?").bind(runId).first<{ status: string }>();
    if (latest?.status === "canceled") await (await bindings.ASSISTANT_WORKFLOW.get(runId)).terminate().catch(() => undefined);
  } catch {
    await runEventStatement(d1, run, "dispatch_failed", { attempt: run.attempts + 1 }, `dispatch-failed-${run.attempts + 1}`).run();
    if (run.attempts + 1 >= 3) await failRun(d1, run, "The investigation could not be started after three attempts. Start a new investigation or continue with manual review.");
  }
}

export async function recoverUndispatchedRuns(bindings: Pick<Env, "DB" | "ASSISTANT_WORKFLOW">) {
  // A process can disappear after reserving its last attempt. Reconcile those
  // rows as well, so an exhausted outbox cannot remain queued indefinitely.
  const exhausted = await bindings.DB.prepare(`SELECT id, workspace_id AS workspaceId, client_id AS clientId FROM assistant_agent_runs
    WHERE status = 'queued' AND dispatched_at IS NULL AND dispatch_attempts >= 3 ORDER BY created_at, id LIMIT 10`).all<RunScope>();
  for (const run of exhausted.results) {
    try {
      const status = await (await bindings.ASSISTANT_WORKFLOW.get(run.id)).status();
      if (status.status === "errored" || status.status === "terminated") throw new Error("Terminal instance");
      await bindings.DB.batch([
        bindings.DB.prepare("UPDATE assistant_agent_runs SET dispatched_at = ? WHERE id = ? AND dispatched_at IS NULL").bind(new Date().toISOString(), run.id),
        runEventStatement(bindings.DB, run, "dispatched", { instanceId: run.id, recoveredAfterLastAttempt: true }, "dispatched"),
      ]);
    } catch { await failRun(bindings.DB, run, "The investigation could not be started after three attempts. Start a new investigation or continue with manual review."); }
  }
  const pending = await bindings.DB.prepare(`SELECT id FROM assistant_agent_runs
    WHERE status = 'queued' AND dispatched_at IS NULL AND dispatch_attempts < 3 ORDER BY created_at, id LIMIT 10`).all<{ id: string }>();
  for (const run of pending.results) await dispatchAssistantRun(bindings, run.id);
}
