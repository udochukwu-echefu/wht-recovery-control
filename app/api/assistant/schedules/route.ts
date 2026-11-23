import { and, desc, eq, lt, or } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { assistantActionProposals, assistantRecurringSchedules, assistantScheduleEvents } from "@/db/schema";
import { ApiError, apiError, enforceRateLimit, requireContext } from "@/lib/auth";
import { assistantApproverRoles, validateActionPayload } from "@/lib/ai/action-contracts";
import { assistantRunRoles } from "@/lib/ai/agent-runs";
import { proposalPreview } from "@/lib/ai/action-proposals";
import { cancelScheduleStatements, scheduleEvent } from "@/lib/ai/recurring-followups";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const cursor = url.searchParams.get("cursor")?.split("|");
    const canReview = (assistantApproverRoles as readonly string[]).includes(context.workspace.role);
    const rows = await getDb().select().from(assistantRecurringSchedules).where(and(
      eq(assistantRecurringSchedules.workspaceId,context.workspace.id),eq(assistantRecurringSchedules.clientId,context.clientId),
      canReview ? undefined : eq(assistantRecurringSchedules.userId,context.user.id), id ? eq(assistantRecurringSchedules.id,id) : undefined,
      cursor?.length === 2 ? or(lt(assistantRecurringSchedules.createdAt,cursor[0]),and(eq(assistantRecurringSchedules.createdAt,cursor[0]),lt(assistantRecurringSchedules.id,cursor[1]))) : undefined,
    )).orderBy(desc(assistantRecurringSchedules.createdAt),desc(assistantRecurringSchedules.id)).limit(51);
    if (id && !rows.length) throw new ApiError(404,"Recurring permission not found in this client workspace.");
    const page = rows.slice(0,50);
    const controls = (row:typeof assistantRecurringSchedules.$inferSelect) => ({...row,canControl:(assistantRunRoles as readonly string[]).includes(context.workspace.role) && (canReview || row.userId === context.user.id)});
    if (id) {
      const events = await getDb().select().from(assistantScheduleEvents).where(and(eq(assistantScheduleEvents.scheduleId,id),eq(assistantScheduleEvents.workspaceId,context.workspace.id),eq(assistantScheduleEvents.clientId,context.clientId))).orderBy(assistantScheduleEvents.id);
      return Response.json({schedule:controls(page[0]),events:events.map((event)=>({eventType:event.eventType,createdAt:event.createdAt,payload:JSON.parse(event.payloadJson)})),canReview});
    }
    const last = page.at(-1);
    return Response.json({schedules:page.map(controls),canReview,nextCursor:rows.length>50 && last ? `${last.createdAt}|${last.id}` : null});
  } catch (error) { return apiError(error,"Recurring permissions could not be loaded."); }
}

export async function POST(request: Request) {
  try {
    const context = await requireContext(request,assistantRunRoles);
    await enforceRateLimit(context,"assistant-schedule-control",20,60);
    const body = await request.json() as Record<string,unknown>;
    const id = typeof body.scheduleId === "string" ? body.scheduleId : "";
    const action = body.action;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || !["pause","revoke","prepare_change"].includes(String(action)) || note.length < 8 || note.length > 1000) throw new ApiError(400,"Choose a recurring permission, action and review note of 8 to 1,000 characters.");
    const canReview = (assistantApproverRoles as readonly string[]).includes(context.workspace.role);
    const schedule = (await getDb().select().from(assistantRecurringSchedules).where(and(eq(assistantRecurringSchedules.id,id),eq(assistantRecurringSchedules.workspaceId,context.workspace.id),eq(assistantRecurringSchedules.clientId,context.clientId),canReview ? undefined : eq(assistantRecurringSchedules.userId,context.user.id))).limit(1))[0];
    if (!schedule) throw new ApiError(404,"Recurring permission not found.");
    if (body.expectedUpdatedAt !== schedule.updatedAt) throw new ApiError(409,"The permission changed. Refresh it before continuing.");
    if (schedule.status === "revoked") throw new ApiError(409,"This permission has been revoked. Prepare a new schedule.");
    const d1 = getD1();
    const now = new Date(Math.max(Date.now(),Date.parse(schedule.updatedAt)+1)).toISOString();
    if (action === "prepare_change") {
      if (!canReview) throw new ApiError(403,"Schedule changes require a reviewer, practitioner or administrator.");
      let payload;
      try { payload = validateActionPayload("schedule_followup",{...(body.payload as object),replacesScheduleId:id,replacesScheduleVersion:schedule.updatedAt}); }
      catch (error) { throw new ApiError(422,error instanceof Error ? error.message : "Invalid recurring permission."); }
      if (!("runAt" in payload) || !payload.recurrence) throw new ApiError(422,"Choose an exact recurring cadence and expiry.");
      const facts = await d1.prepare(`SELECT rc.customer,rc.updated_at,p.ai_job_id FROM recovery_cases rc JOIN assistant_action_proposals p ON p.id=?
        JOIN users u ON u.id=? AND u.status='active' JOIN workspace_memberships m ON m.user_id=u.id AND m.workspace_id=rc.workspace_id AND m.status='active' AND m.role IN ('admin','practitioner','reviewer')
        WHERE rc.id=? AND rc.workspace_id=? AND rc.client_id=? AND rc.deleted_at IS NULL`).bind(schedule.approvalProposalId,schedule.userId,schedule.caseId,context.workspace.id,context.clientId).first<{customer:string;updated_at:string;ai_job_id:string}>();
      if (!facts) throw new ApiError(409,"The original requester or case is no longer eligible. Prepare a new schedule in your own conversation.");
      const proposalId = crypto.randomUUID();
      await d1.batch([
        d1.prepare(`INSERT INTO assistant_action_proposals (id,workspace_id,client_id,conversation_id,ai_job_id,case_id,case_updated_at,action_type,payload_json,source_labels_json,proposed_by_user_id,created_at)
          VALUES (?,?,?,?,?,?,?,'schedule_followup',?,?,?,?)`).bind(proposalId,context.workspace.id,context.clientId,schedule.conversationId,facts.ai_job_id,schedule.caseId,facts.updated_at,JSON.stringify({...payload,customer:facts.customer}),JSON.stringify([`case:${schedule.caseId}`]),schedule.userId,now),
        scheduleEvent(d1,id,"change_proposed",{proposalId,requestedByUserId:context.user.id,note},`change-${proposalId}`,now),
      ]);
      const proposal = (await getDb().select().from(assistantActionProposals).where(eq(assistantActionProposals.id,proposalId)).limit(1))[0];
      return Response.json({proposal:await proposalPreview(proposal)},{status:201});
    }
    if (action === "pause" && schedule.status !== "active") throw new ApiError(409,"Only an active recurring permission can be paused.");
    const status = action === "pause" ? "paused" : "revoked";
    const results = await d1.batch([
      d1.prepare(`UPDATE assistant_recurring_schedules SET status=?,next_run_at=NULL,updated_at=? WHERE id=? AND workspace_id=? AND client_id=? AND updated_at=? AND status <> 'revoked'
        AND EXISTS (SELECT 1 FROM workspace_memberships m JOIN users u ON u.id=m.user_id AND u.status='active' WHERE m.workspace_id=? AND m.user_id=? AND m.status='active' AND m.role=?)`).bind(status,now,id,context.workspace.id,context.clientId,schedule.updatedAt,context.workspace.id,context.user.id,context.workspace.role),
      d1.prepare(`INSERT INTO assistant_schedule_events (event_key,schedule_id,workspace_id,client_id,event_type,payload_json,created_at)
        SELECT ?,id,workspace_id,client_id,?,?,? FROM assistant_recurring_schedules WHERE id=? AND status=? AND updated_at=?`).bind(`${id}:${status}:${now}`,status,JSON.stringify({actorUserId:context.user.id,note}),now,id,status,now),
      d1.prepare(`INSERT INTO audit_events (id,workspace_id,case_id,event_type,actor,actor_user_id,actor_display_name,actor_role,detail_json,created_at)
        SELECT ?,workspace_id,case_id,?,'user',?,?,?,?,? FROM assistant_recurring_schedules WHERE id=? AND status=? AND updated_at=?`).bind(crypto.randomUUID(),`AI_RECURRING_PERMISSION_${status.toUpperCase()}`,context.user.id,context.user.displayName,context.workspace.role,JSON.stringify({scheduleId:id,note}),now,id,status,now),
      ...cancelScheduleStatements(d1,id,now,context.user.id,`Recurring permission ${status}.`),
    ]);
    if (!results[0].meta.changes) throw new ApiError(409,"The permission or access changed. Refresh and review again.");
    return Response.json({scheduleId:id,status});
  } catch (error) { return apiError(error,"Recurring permission could not be updated."); }
}
