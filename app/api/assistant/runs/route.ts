import { env } from "cloudflare:workers";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { assistantAgentRuns, assistantConversations, assistantRunEvents } from "@/db/schema";
import { ApiError, apiError, enforceRateLimit, requireContext } from "@/lib/auth";
import { assistantApproverRoles } from "@/lib/ai/action-contracts";
import { assistantRunRoles, dispatchAssistantRun, runEventStatement } from "@/lib/ai/agent-runs";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const cursor = url.searchParams.get("cursor")?.split("|");
    const canReview = (assistantApproverRoles as readonly string[]).includes(context.workspace.role);
    const rows = await getDb().select().from(assistantAgentRuns).where(and(
      eq(assistantAgentRuns.workspaceId, context.workspace.id), eq(assistantAgentRuns.clientId, context.clientId),
      canReview ? undefined : eq(assistantAgentRuns.userId, context.user.id),
      id ? eq(assistantAgentRuns.id, id) : undefined,
      cursor?.length === 2 ? or(lt(assistantAgentRuns.createdAt, cursor[0]), and(eq(assistantAgentRuns.createdAt, cursor[0]), lt(assistantAgentRuns.id, cursor[1]))) : undefined,
    )).orderBy(desc(assistantAgentRuns.createdAt), desc(assistantAgentRuns.id)).limit(51);
    if (id && !rows.length) throw new ApiError(404, "Investigation not found in this client workspace.");
    const page = rows.slice(0, 50);
    const last = page.at(-1);
    if (id) {
      const events = await getDb().select().from(assistantRunEvents).where(and(eq(assistantRunEvents.runId, id), eq(assistantRunEvents.workspaceId, context.workspace.id), eq(assistantRunEvents.clientId, context.clientId))).orderBy(assistantRunEvents.id);
      return Response.json({ run: { ...page[0], progress: JSON.parse(page[0].progressJson), progressJson: undefined }, events: events.map((event) => ({ id: event.id, eventType: event.eventType, attempt: event.attempt, createdAt: event.createdAt, payload: JSON.parse(event.payloadJson) })), canCancel: (assistantRunRoles as readonly string[]).includes(context.workspace.role) && (canReview || page[0].userId === context.user.id) });
    }
    return Response.json({ runs: page.map((run) => ({ ...run, progress: JSON.parse(run.progressJson), progressJson: undefined })), canReview, nextCursor: rows.length > 50 && last ? `${last.createdAt}|${last.id}` : null });
  } catch (error) {
    return apiError(error, "Investigation history is unavailable.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireContext(request, assistantRunRoles);
    await enforceRateLimit(context, "assistant-background", 4, 60);
    const body = await request.json() as Record<string, unknown>;
    const conversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!conversationId || question.length < 2 || question.length > 300) throw new ApiError(400, "Choose a conversation and enter a question of 2 to 300 characters.");
    const conversation = (await getDb().select().from(assistantConversations).where(and(
      eq(assistantConversations.id, conversationId), eq(assistantConversations.workspaceId, context.workspace.id),
      eq(assistantConversations.clientId, context.clientId), eq(assistantConversations.userId, context.user.id),
    )).limit(1))[0];
    if (!conversation) throw new ApiError(404, "Conversation not found.");
    const now = new Date().toISOString();
    const runId = crypto.randomUUID();
    const d1 = getD1();
    const ownerGuard = `id = ? AND workspace_id = ? AND client_id = ? AND user_id = ?`;
    const ownerArgs = [conversationId, context.workspace.id, context.clientId, context.user.id];
    const metadata = JSON.stringify({ backgroundRun: { id: runId, status: "queued" }, activity: [{ id: "queued", kind: "status", label: "Investigation queued", state: "running" }] });
    await d1.batch([
      d1.prepare(`INSERT INTO assistant_messages (conversation_id, role, content, metadata_json, created_at)
        SELECT id, 'user', ?, ?, ? FROM assistant_conversations WHERE ${ownerGuard}`)
        .bind(question, JSON.stringify({ runRequestId: runId }), now, ...ownerArgs),
      d1.prepare(`INSERT INTO assistant_messages (conversation_id, role, content, metadata_json, ai_job_id, created_at)
        SELECT id, 'assistant', '', ?, ?, ? FROM assistant_conversations WHERE ${ownerGuard}`)
        .bind(metadata, runId, now, ...ownerArgs),
      d1.prepare(`INSERT INTO assistant_agent_runs (id, workspace_id, client_id, conversation_id, user_id, user_message_id, assistant_message_id, question, status, created_at, updated_at)
        SELECT ?, workspace_id, client_id, id, user_id,
          (SELECT id FROM assistant_messages WHERE conversation_id = a.id AND role = 'user' AND json_extract(metadata_json, '$.runRequestId') = ? LIMIT 1),
          (SELECT id FROM assistant_messages WHERE conversation_id = a.id AND role = 'assistant' AND ai_job_id = ? LIMIT 1), ?, 'queued', ?, ?
        FROM assistant_conversations a WHERE ${ownerGuard}`)
        .bind(runId, runId, runId, question, now, now, ...ownerArgs),
      d1.prepare(`UPDATE assistant_conversations SET updated_at = ? WHERE ${ownerGuard}`).bind(now, ...ownerArgs),
      runEventStatement(d1, { id: runId, workspaceId: context.workspace.id, clientId: context.clientId }, "queued", { question, requestedByUserId: context.user.id }, "queued"),
      d1.prepare(`INSERT INTO audit_events (id, workspace_id, event_type, actor, actor_user_id, actor_display_name, actor_role, detail_json, created_at)
        VALUES (?, ?, 'AI_INVESTIGATION_REQUESTED', 'user', ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), context.workspace.id, context.user.id, context.user.displayName, context.workspace.role, JSON.stringify({ runId, conversationId, consequentialActionTaken: false }), now),
    ]);
    await dispatchAssistantRun(env, runId);
    const run = await d1.prepare("SELECT assistant_message_id, status FROM assistant_agent_runs WHERE id = ?").bind(runId).first<{ assistant_message_id: number; status: string }>();
    return Response.json({ runId, conversationId, assistantMessageId: run?.assistant_message_id, status: run?.status ?? "queued" }, { status: 202 });
  } catch (error) {
    return apiError(error, "The investigation could not be started.");
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireContext(request, assistantRunRoles);
    await enforceRateLimit(context, "assistant-cancel", 20, 60);
    const body = await request.json() as Record<string, unknown>;
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new ApiError(400, "A valid run ID is required.");
    const canReview = (assistantApproverRoles as readonly string[]).includes(context.workspace.role);
    const run = (await getDb().select().from(assistantAgentRuns).where(and(
      eq(assistantAgentRuns.id, runId), eq(assistantAgentRuns.workspaceId, context.workspace.id), eq(assistantAgentRuns.clientId, context.clientId),
      canReview ? undefined : eq(assistantAgentRuns.userId, context.user.id),
    )).limit(1))[0];
    if (!run) throw new ApiError(404, "Investigation not found.");
    const now = new Date().toISOString();
    const d1 = getD1();
    const results = await d1.batch([
      d1.prepare(`UPDATE assistant_agent_runs SET status = 'canceled', updated_at = ?, completed_at = ?
        WHERE id = ? AND workspace_id = ? AND client_id = ? AND status IN ('queued', 'running')`)
        .bind(now, now, runId, context.workspace.id, context.clientId),
      d1.prepare(`UPDATE assistant_messages SET metadata_json = json_set(metadata_json, '$.backgroundRun.status', 'canceled', '$.error', 'Investigation canceled.')
        WHERE id = ? AND conversation_id = ? AND EXISTS (SELECT 1 FROM assistant_agent_runs WHERE id = ? AND status = 'canceled' AND completed_at = ?)`)
        .bind(run.assistantMessageId, run.conversationId, runId, now),
      d1.prepare(`UPDATE ai_jobs SET status = 'failed', validation_outcome = 'rejected', error_code = 'AGENT_CANCELED', error_message = 'Investigation canceled.', completed_at = ?
        WHERE id = ? AND workspace_id = ? AND client_id = ? AND status = 'processing'
        AND EXISTS (SELECT 1 FROM assistant_agent_runs WHERE id = ? AND status = 'canceled' AND completed_at = ?)`)
        .bind(now, runId, context.workspace.id, context.clientId, runId, now),
      d1.prepare(`INSERT OR IGNORE INTO assistant_run_events (event_key, run_id, workspace_id, client_id, event_type, payload_json, created_at)
        SELECT ?, id, workspace_id, client_id, 'canceled', ?, ? FROM assistant_agent_runs WHERE id = ? AND status = 'canceled' AND completed_at = ?`)
        .bind(`${runId}:canceled`, JSON.stringify({ canceledByUserId: context.user.id }), now, runId, now),
      d1.prepare(`INSERT OR IGNORE INTO audit_events (id, workspace_id, case_id, event_type, actor, actor_user_id, actor_display_name, actor_role, detail_json, created_at)
        SELECT ?, workspace_id, case_id, 'AI_INVESTIGATION_CANCELED', 'user', ?, ?, ?, ?, ? FROM assistant_agent_runs WHERE id = ? AND status = 'canceled' AND completed_at = ?`)
        .bind(`${runId}:canceled`, context.user.id, context.user.displayName, context.workspace.role, JSON.stringify({ runId }), now, runId, now),
    ]);
    if (!results[0].meta.changes) throw new ApiError(409, "This investigation has already finished or been canceled.");
    try { await (await env.ASSISTANT_WORKFLOW.get(runId)).terminate(); }
    catch { /* Persistent cancellation guards stop reads and publication. */ }
    return Response.json({ runId, status: "canceled" });
  } catch (error) {
    return apiError(error, "The investigation could not be canceled.");
  }
}
