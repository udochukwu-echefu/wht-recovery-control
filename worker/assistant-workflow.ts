import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { and, desc, eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { aiJobs, assistantAgentRuns, assistantMessages } from "@/db/schema";
import { ApiError } from "@/lib/auth";
import { runPortfolioAgent } from "@/lib/ai/portfolio-agent";
import { failRun, runContext, runEventStatement } from "@/lib/ai/agent-runs";
import { recurringRunPermissionSql } from "@/lib/ai/recurring-followups";

type Params = { runId: string };
type Activity = { id: string; kind: "status" | "tool"; label: string; state: "running" | "complete"; detail?: string };
const retry = { retries: { limit: 1, delay: "2 seconds" }, timeout: "3 minutes" } as const;

export class AssistantInvestigationWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const runId = event.payload.runId;
    const loadRun = async () => {
      const run = (await getDb().select().from(assistantAgentRuns).where(eq(assistantAgentRuns.id, runId)).limit(1))[0];
      if (!run) throw new ApiError(404, "Investigation unavailable.");
      return run;
    };
    try {
      // Only persisted step returns determine whether this run sleeps. Identity
      // is resolved again after waking, and for every tool and publication.
      const prepared = await step.do("read investigation request", retry, async () => {
        const run = await loadRun();
        await runContext(run);
        if (run.status === "canceled" || run.status === "failed") throw new ApiError(409, "Investigation unavailable or canceled.");
        return { scheduledFor: run.scheduledFor };
      });
      if (prepared.scheduledFor) await step.sleepUntil("wait for approved follow-up time", new Date(prepared.scheduledFor));

      const result = await step.do("investigate with scoped tools", retry, async () => {
        const run = await loadRun();
        if (run.status === "canceled" || run.status === "failed") throw new ApiError(409, "Investigation unavailable or canceled.");
        const context = await runContext(run);
        const rows = await getDb().select({ role: assistantMessages.role, content: assistantMessages.content }).from(assistantMessages).where(and(
          eq(assistantMessages.conversationId, run.conversationId), lt(assistantMessages.id, run.userMessageId),
        )).orderBy(desc(assistantMessages.id)).limit(12);
        const priorJob = (await getDb().select({ attemptCount: aiJobs.attemptCount, status: aiJobs.status }).from(aiJobs).where(eq(aiJobs.id, runId)).limit(1))[0];
        const attempt = priorJob?.status === "completed" ? priorJob.attemptCount : (priorJob?.attemptCount ?? 0) + 1;
        await runEventStatement(this.env.DB, run, "attempt_started", { caseId: run.caseId, question: run.question }, `attempt-${attempt}-started`, attempt).run();
        const activity = JSON.parse(run.progressJson) as Activity[];
        const persist = async (entry: Activity) => {
          const current = await loadRun();
          if (current.status === "canceled" || current.status === "failed") throw new ApiError(409, "Investigation canceled.");
          await runContext(current);
          if (entry.kind === "status") for (const item of activity) if (item.kind === "status") item.state = "complete";
          const prior = activity.findIndex((item) => item.id === entry.id && item.kind === entry.kind);
          if (prior >= 0) activity.splice(prior, 1);
          activity.push(entry);
          await this.env.DB.batch([
            this.env.DB.prepare("UPDATE assistant_agent_runs SET status = 'running', progress_json = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')")
              .bind(JSON.stringify(activity), new Date().toISOString(), runId),
            this.env.DB.prepare(`UPDATE assistant_messages SET metadata_json = json_set(metadata_json, '$.activity', json(?), '$.backgroundRun.status', 'running', '$.backgroundRun.phase', ?)
              WHERE id = ? AND conversation_id = ? AND EXISTS (SELECT 1 FROM assistant_agent_runs WHERE id = ? AND status = 'running')`)
              .bind(JSON.stringify(activity), entry.label, run.assistantMessageId, run.conversationId, runId),
          ]);
        };
        try {
          const answer = await runPortfolioAgent({
            context, conversationId: run.conversationId, fixedJobId: runId, caseScopeId: run.caseId ?? undefined,
            question: run.question, history: rows.reverse(),
            onStatus: (label) => persist({ id: `status-${label}`, kind: "status", label, state: "running" }),
            onTool: (tool) => persist({ id: tool.id, kind: "tool", label: tool.label, state: tool.state, detail: tool.detail }),
            onTrace: async (trace, currentAttempt) => {
              await runEventStatement(this.env.DB, run, trace.kind, trace, `attempt-${currentAttempt}-${trace.callId}-${trace.kind}`, currentAttempt).run();
            },
          });
          // Keep arbitrary tool records in the D1 journal, outside the Workflow
          // step result. The step returns only the validated answer contract.
          return {
            jobId: answer.jobId, provider: answer.provider,
            output: { answer: answer.output.answer, sourceLabels: answer.output.sourceLabels, limitations: answer.output.limitations, suggestedAction: answer.output.suggestedAction },
            toolNames: answer.toolTrace.map((tool) => tool.name),
          };
        } catch (error) {
          await runEventStatement(this.env.DB, run, "attempt_failed", { message: error instanceof ApiError ? error.message : "Investigation step failed." }, `attempt-${attempt}-failed`, attempt).run();
          throw error;
        }
      });

      await step.do("save investigation response", retry, async () => {
        const current = await loadRun();
        if (current.status === "canceled" || current.status === "completed" || current.status === "failed") return;
        const context = await runContext(current);
        const now = new Date().toISOString();
        const activity = (JSON.parse(current.progressJson) as Activity[]).map((item) => ({ ...item, state: "complete" as const }));
        const metadata = {
          sourceLabels: result.output.sourceLabels, limitations: result.output.limitations, suggestedAction: result.output.suggestedAction,
          action: { label: current.caseId ? "View follow-up case" : "View recovery cases", ...(current.caseId ? { caseId: current.caseId } : {}) },
          aiJobId: result.jobId, activity,
          backgroundRun: { id: runId, status: "completed", ...(current.scheduledFor ? { scheduledFor: current.scheduledFor } : {}), ...(current.recurringScheduleId ? {scheduleId:current.recurringScheduleId} : {}) },
        };
        const changes = await this.env.DB.batch([
          this.env.DB.prepare(`UPDATE assistant_agent_runs SET status = 'completed', progress_json = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status IN ('queued', 'running')
            AND EXISTS (SELECT 1 FROM workspace_memberships m JOIN users u ON u.id = m.user_id AND u.status = 'active'
              JOIN clients c ON c.id = assistant_agent_runs.client_id AND c.workspace_id = m.workspace_id AND c.status = 'active'
              WHERE m.workspace_id = assistant_agent_runs.workspace_id AND m.user_id = assistant_agent_runs.user_id AND m.status = 'active' AND m.role IN ('admin','practitioner','reviewer','analyst'))
            AND (case_id IS NULL OR EXISTS (SELECT 1 FROM recovery_cases rc WHERE rc.id = assistant_agent_runs.case_id AND rc.workspace_id = assistant_agent_runs.workspace_id AND rc.client_id = assistant_agent_runs.client_id AND rc.deleted_at IS NULL))
            AND ${recurringRunPermissionSql("assistant_agent_runs")}`)
            .bind(JSON.stringify(activity), now, now, runId),
          this.env.DB.prepare(`UPDATE assistant_messages SET content = ?, metadata_json = ? WHERE id = ? AND conversation_id = ?
            AND EXISTS (SELECT 1 FROM assistant_agent_runs WHERE id = ? AND status = 'completed')`)
            .bind(result.output.answer, JSON.stringify(metadata), current.assistantMessageId, current.conversationId, runId),
          this.env.DB.prepare("UPDATE assistant_conversations SET title = CASE WHEN title = 'New conversation' THEN ? ELSE title END, updated_at = ? WHERE id = ? AND workspace_id = ? AND client_id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM assistant_agent_runs WHERE id = ? AND status = 'completed')")
            .bind(current.question.slice(0, 72), now, current.conversationId, context.workspace.id, context.clientId, context.user.id, runId),
          this.env.DB.prepare(`INSERT OR IGNORE INTO audit_events (id, workspace_id, case_id, document_id, event_type, actor, actor_user_id, actor_display_name, actor_role, detail_json, created_at)
            SELECT ?, ?, ?, NULL, 'AI_PORTFOLIO_AGENT_GENERATED', 'ai-assistant', ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM assistant_agent_runs WHERE id = ? AND status = 'completed')`)
            .bind(runId, context.workspace.id, current.caseId, context.user.id, context.user.displayName, context.workspace.role,
              JSON.stringify({ jobId: result.jobId, conversationId: current.conversationId, provider: result.provider, toolNames: result.toolNames, consequentialActionTaken: false, background: true, scheduledFollowup: Boolean(current.scheduledFor) }), now, runId),
          this.env.DB.prepare(`INSERT OR IGNORE INTO assistant_run_events (event_key, run_id, workspace_id, client_id, event_type, payload_json, created_at)
            SELECT ?, id, workspace_id, client_id, 'completed', ?, ? FROM assistant_agent_runs WHERE id = ? AND status = 'completed'`)
            .bind(`${runId}:completed`, JSON.stringify({ answer: result.output, jobId: result.jobId }), now, runId),
        ]);
        if (!changes[0].meta.changes) {
          const latest = await loadRun();
          if (latest.status !== "canceled") throw new ApiError(403, "Workspace access changed before the investigation could be published.");
        }
      });
    } catch (error) {
      await step.do("record investigation failure", retry, async () => {
        const current = await loadRun();
        if (current.status === "canceled" || current.status === "completed" || current.status === "failed") return;
        const message = error instanceof ApiError ? error.message.slice(0, 240) : "The investigation could not finish. Start a new investigation or continue with manual review.";
        await failRun(this.env.DB, current, message);
      });
    }
  }
}
