import { env } from "cloudflare:workers";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { assistantActionProposals } from "@/db/schema";
import { ApiError, apiError, enforceRateLimit, requireContext } from "@/lib/auth";
import { assistantApproverRoles, validateActionPayload } from "@/lib/ai/action-contracts";
import { proposalPreview } from "@/lib/ai/action-proposals";
import { dispatchAssistantRun, runEventStatement } from "@/lib/ai/agent-runs";
import { cancelScheduleStatements, scheduleEvent } from "@/lib/ai/recurring-followups";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const status = url.searchParams.get("status") ?? "pending";
    if (!["pending", "approved", "rejected", "all"].includes(status)) throw new ApiError(400, "Invalid proposal status.");
    const canReview = (assistantApproverRoles as readonly string[]).includes(context.workspace.role);
    const cursor = url.searchParams.get("cursor")?.split("|");
    const rows = await getDb().select().from(assistantActionProposals).where(and(
      eq(assistantActionProposals.workspaceId, context.workspace.id),
      eq(assistantActionProposals.clientId, context.clientId),
      canReview ? undefined : eq(assistantActionProposals.proposedByUserId, context.user.id),
      id ? eq(assistantActionProposals.id, id) : status === "all" ? undefined : eq(assistantActionProposals.status, status),
      cursor?.length === 2 ? or(lt(assistantActionProposals.createdAt, cursor[0]), and(eq(assistantActionProposals.createdAt, cursor[0]), lt(assistantActionProposals.id, cursor[1]))) : undefined,
    )).orderBy(desc(assistantActionProposals.createdAt), desc(assistantActionProposals.id)).limit(51);
    const page = rows.slice(0, 50);
    const last = page.at(-1);
    return Response.json({ proposals: await Promise.all(page.map(proposalPreview)), canReview, nextCursor: rows.length > 50 && last ? `${last.createdAt}|${last.id}` : null });
  } catch (error) {
    return apiError(error, "Action proposals could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireContext(request, assistantApproverRoles);
    await enforceRateLimit(context, "assistant-proposal-review", 20, 60);
    const body = await request.json() as Record<string, unknown>;
    const proposalId = typeof body.proposalId === "string" ? body.proposalId.trim() : "";
    const decision = body.decision;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(proposalId) || (decision !== "approve" && decision !== "reject") || note.length < 8 || note.length > 1_000) throw new ApiError(400, "Choose a proposal, decision and review note of 8 to 1,000 characters.");
    const proposal = (await getDb().select().from(assistantActionProposals).where(and(
      eq(assistantActionProposals.id, proposalId), eq(assistantActionProposals.workspaceId, context.workspace.id), eq(assistantActionProposals.clientId, context.clientId),
    )).limit(1))[0];
    if (!proposal) throw new ApiError(404, "Proposal not found in this client workspace.");
    if (proposal.status !== "pending") throw new ApiError(409, "This proposal has already been reviewed.");
    const preview = await proposalPreview(proposal);
    if (body.previewHash !== preview.previewHash) throw new ApiError(409, "Reload and review the exact proposal before deciding.");
    try { validateActionPayload(preview.actionType, preview.payload, decision === "approve"); }
    catch (error) { throw new ApiError(422, error instanceof Error ? error.message : "Invalid proposed effects."); }

    const d1 = getD1();
    const now = new Date().toISOString();
    const caseVersion = new Date(Math.max(Date.now(), (Date.parse(proposal.caseUpdatedAt) || 0) + 1)).toISOString();
    const decisionId = crypto.randomUUID();
    const status = decision === "approve" ? "approved" : "rejected";
    const scope = { id: proposalId, workspaceId: context.workspace.id, clientId: context.clientId };
    const guard = "id = ? AND workspace_id = ? AND client_id = ? AND status = 'approved' AND decision_id = ?";
    const guardArgs = [proposalId, context.workspace.id, context.clientId, decisionId];
    const ownerGuard = preview.actionType === "case_assignment" ? `AND EXISTS (
      SELECT 1 FROM workspace_memberships m JOIN users u ON u.id = m.user_id AND u.status = 'active'
      WHERE m.workspace_id = assistant_action_proposals.workspace_id AND m.status = 'active'
      AND m.user_id = json_extract(payload_json, '$.ownerId') AND m.role = json_extract(payload_json, '$.ownerRole')
      AND u.display_name = json_extract(payload_json, '$.ownerName'))` : "";
    const scheduleGuard = preview.actionType === "schedule_followup" ? `AND EXISTS (SELECT 1 FROM users u JOIN workspace_memberships m ON m.user_id=u.id
      WHERE u.id=assistant_action_proposals.proposed_by_user_id AND u.status='active' AND m.workspace_id=assistant_action_proposals.workspace_id AND m.status='active' AND m.role IN ('admin','practitioner','reviewer','analyst'))
      AND (json_extract(payload_json,'$.replacesScheduleId') IS NULL OR EXISTS (SELECT 1 FROM assistant_recurring_schedules s
        WHERE s.id=json_extract(payload_json,'$.replacesScheduleId') AND s.updated_at=json_extract(payload_json,'$.replacesScheduleVersion') AND s.status <> 'revoked'
        AND s.workspace_id=assistant_action_proposals.workspace_id AND s.client_id=assistant_action_proposals.client_id AND s.case_id=assistant_action_proposals.case_id
        AND s.conversation_id=assistant_action_proposals.conversation_id AND s.user_id=assistant_action_proposals.proposed_by_user_id))` : "";
    const statements = [d1.prepare(`UPDATE assistant_action_proposals
      SET status = ?, reviewed_by_user_id = ?, reviewer_note = ?, reviewed_at = ?, decision_id = ?
      WHERE id = ? AND workspace_id = ? AND client_id = ? AND status = 'pending'
      AND EXISTS (SELECT 1 FROM workspace_memberships m JOIN users u ON u.id = m.user_id AND u.status = 'active'
        JOIN clients c ON c.workspace_id = m.workspace_id AND c.id = ? AND c.status = 'active'
        WHERE m.workspace_id = ? AND m.user_id = ? AND m.status = 'active' AND m.role = ? AND m.role IN ('admin','practitioner','reviewer'))
      ${decision === "approve" ? `AND EXISTS (SELECT 1 FROM recovery_cases WHERE id = assistant_action_proposals.case_id
        AND workspace_id = assistant_action_proposals.workspace_id AND client_id = assistant_action_proposals.client_id
        AND deleted_at IS NULL AND updated_at = assistant_action_proposals.case_updated_at) ${ownerGuard} ${scheduleGuard}` : ""}`)
      .bind(status, context.user.id, note, now, decisionId, proposalId, context.workspace.id, context.clientId, context.clientId, context.workspace.id, context.user.id, context.workspace.role)];

    if (decision === "approve") {
      if (preview.actionType === "case_note") statements.push(d1.prepare(`INSERT INTO case_notes (id, workspace_id, case_id, body, created_by_user_id, created_at)
        SELECT id, workspace_id, case_id, json_extract(payload_json, '$.body'), ?, ? FROM assistant_action_proposals WHERE ${guard}`)
        .bind(context.user.id, now, ...guardArgs));
      if (preview.actionType === "case_checklist") statements.push(d1.prepare(`INSERT INTO case_checklist_items (id, workspace_id, case_id, label, status, created_at)
        SELECT id, workspace_id, case_id, json_extract(payload_json, '$.label'), 'open', ? FROM assistant_action_proposals WHERE ${guard}`)
        .bind(now, ...guardArgs));
      if (preview.actionType === "communication_draft") statements.push(d1.prepare(`INSERT INTO communication_drafts
        (id, workspace_id, case_id, draft_type, status, subject, body, ai_job_id, created_at, approved_at, approved_by_user_id, source_snapshot_json)
        SELECT id, workspace_id, case_id, 'customer_follow_up', 'approved', json_extract(payload_json, '$.subject'), json_extract(payload_json, '$.body'), ai_job_id, ?, ?, ?, ?
        FROM assistant_action_proposals WHERE ${guard}`)
        .bind(now, now, context.user.id, JSON.stringify({ caseUpdatedAt: proposal.caseUpdatedAt, sourceLabels: preview.sourceLabels, previewHash: preview.previewHash, effects: preview.payload, noMessageSent: true }), ...guardArgs));
      if (preview.actionType === "schedule_followup" && "runAt" in preview.payload) {
        if (preview.payload.recurrence) {
          if (preview.payload.replacesScheduleId) statements.push(d1.prepare(`UPDATE assistant_recurring_schedules SET status='revoked',next_run_at=NULL,updated_at=MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ',updated_at,'+0.001 seconds'))
            WHERE id=? AND EXISTS (SELECT 1 FROM assistant_action_proposals WHERE ${guard})`).bind(now,preview.payload.replacesScheduleId,...guardArgs));
          statements.push(
            d1.prepare(`INSERT INTO assistant_recurring_schedules (id,workspace_id,client_id,conversation_id,user_id,case_id,question,starts_at,every_days,ends_at,approval_proposal_id,approved_by_user_id,next_run_at,created_at,updated_at)
              SELECT id,workspace_id,client_id,conversation_id,proposed_by_user_id,case_id,json_extract(payload_json,'$.question'),json_extract(payload_json,'$.runAt'),json_extract(payload_json,'$.recurrence.everyDays'),json_extract(payload_json,'$.recurrence.until'),id,?,json_extract(payload_json,'$.runAt'),?,?
              FROM assistant_action_proposals WHERE ${guard}`).bind(context.user.id,now,now,...guardArgs),
            scheduleEvent(d1,proposalId,"permission_approved",{ approvedByUserId:context.user.id,previewHash:preview.previewHash,effects:preview.payload },"approved",now),
          );
          if (preview.payload.replacesScheduleId) statements.push(
            d1.prepare(`INSERT OR IGNORE INTO assistant_schedule_events (event_key,schedule_id,workspace_id,client_id,event_type,payload_json,created_at)
              SELECT ?,id,workspace_id,client_id,'replaced',?,? FROM assistant_recurring_schedules WHERE id=? AND EXISTS (SELECT 1 FROM assistant_action_proposals WHERE ${guard})`).bind(`${preview.payload.replacesScheduleId}:replaced-${proposalId}`,JSON.stringify({newScheduleId:proposalId,approvedByUserId:context.user.id}),now,preview.payload.replacesScheduleId,...guardArgs),
            ...cancelScheduleStatements(d1,preview.payload.replacesScheduleId,now,context.user.id,"Recurring permission replaced by an approved change."),
          );
        } else {
        const metadata = JSON.stringify({ backgroundRun: { id: proposalId, status: "queued", scheduledFor: preview.payload.runAt }, activity: [{ id: "scheduled", kind: "status", label: `Follow-up scheduled for ${preview.payload.runAt}`, state: "running" }] });
        statements.push(
          d1.prepare(`INSERT INTO assistant_messages (conversation_id, role, content, metadata_json, created_at)
            SELECT conversation_id, 'user', ?, ?, ? FROM assistant_action_proposals WHERE ${guard}`)
            .bind(`Approved internal follow-up: ${preview.payload.question}`, JSON.stringify({ scheduledFollowup: proposalId, approvedByUserId: context.user.id }), now, ...guardArgs),
          d1.prepare(`INSERT INTO assistant_messages (conversation_id, role, content, metadata_json, ai_job_id, created_at)
            SELECT conversation_id, 'assistant', '', ?, id, ? FROM assistant_action_proposals WHERE ${guard}`)
            .bind(metadata, now, ...guardArgs),
          d1.prepare(`INSERT INTO assistant_agent_runs
            (id, workspace_id, client_id, conversation_id, user_id, user_message_id, assistant_message_id, question, case_id, scheduled_for, approval_proposal_id, created_at, updated_at)
            SELECT id, workspace_id, client_id, conversation_id, proposed_by_user_id,
              (SELECT id FROM assistant_messages WHERE conversation_id = p.conversation_id AND role = 'user' AND json_extract(metadata_json, '$.scheduledFollowup') = p.id LIMIT 1),
              (SELECT id FROM assistant_messages WHERE conversation_id = p.conversation_id AND role = 'assistant' AND ai_job_id = p.id LIMIT 1),
              json_extract(payload_json, '$.question'), case_id, json_extract(payload_json, '$.runAt'), id, ?, ?
            FROM assistant_action_proposals p WHERE ${guard}`)
            .bind(now, now, ...guardArgs),
          runEventStatement(d1, scope, "scheduled", { proposalId, approvedByUserId: context.user.id, previewHash: preview.previewHash, effects: preview.payload }, "scheduled"),
        );
        }
      }
      let changes = "";
      const payload = preview.payload;
      const values: Array<string | null> = [];
      if ("ownerId" in payload) { changes = "assigned_owner_id = ?, owner_role = ?, "; values.push(payload.ownerId, payload.ownerRole); }
      if ("priority" in payload) { changes = "priority = ?, "; values.push(payload.priority); }
      if ("dueDate" in payload) { changes = "due_date = ?, "; values.push(payload.dueDate); }
      statements.push(d1.prepare(`UPDATE recovery_cases SET ${changes}updated_at = MAX(?, strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds'))
        WHERE id = ? AND workspace_id = ? AND client_id = ? AND EXISTS (SELECT 1 FROM assistant_action_proposals WHERE ${guard})`)
        .bind(...values, caseVersion, proposal.caseId, context.workspace.id, context.clientId, ...guardArgs));
    }
    statements.push(d1.prepare(`INSERT INTO audit_events
      (id, workspace_id, case_id, document_id, event_type, actor, actor_user_id, actor_display_name, actor_role, detail_json, created_at)
      SELECT ?, workspace_id, case_id, NULL, ?, 'user', ?, ?, ?, ?, ? FROM assistant_action_proposals
      WHERE id = ? AND workspace_id = ? AND client_id = ? AND decision_id = ? AND status = ?`)
      .bind(crypto.randomUUID(), `AI_${proposal.actionType.toUpperCase()}_PROPOSAL_${decision === "approve" ? "APPROVED" : "REJECTED"}`, context.user.id, context.user.displayName, context.workspace.role,
        JSON.stringify({ proposalId, decision, note, previewHash: preview.previewHash, caseUpdatedAt: proposal.caseUpdatedAt, actionType: proposal.actionType, exactEffects: preview.payload, sourceLabels: preview.sourceLabels, noMessageSent: true }), now,
        proposalId, context.workspace.id, context.clientId, decisionId, status));
    const results = await d1.batch(statements);
    if (!results[0].meta.changes) throw new ApiError(409, "The proposal, case or permissions changed. Reload and prepare a fresh proposal.");
    if (decision === "approve" && "runAt" in preview.payload) {
      if (!preview.payload.recurrence) await dispatchAssistantRun(env, proposalId);
    }
    return Response.json({ proposalId, caseId: proposal.caseId, status, reviewedAt: now, caseNoteId: decision === "approve" && proposal.actionType === "case_note" ? proposalId : null });
  } catch (error) {
    return apiError(error, "The proposal could not be reviewed.");
  }
}
