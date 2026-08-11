import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { aiJobs, auditEvents, communicationDrafts, recoveryPlans } from "@/db/schema";
import type { AiTaskType, CaseCopilotOutput, CommunicationDraftOutput, EvidenceSummaryOutput, PortfolioBriefingOutput, RecoveryPlanOutput } from "@/lib/ai/contracts";
import { runAiTask } from "@/lib/ai/service";

export const runtime = "edge";

const actionTask: Record<string, AiTaskType> = {
  "recovery-plan": "recovery_plan",
  "communication-draft": "communication_draft",
  "evidence-summary": "evidence_summary",
  "portfolio-briefing": "portfolio_briefing",
  copilot: "case_copilot",
};

export async function GET() {
  try {
    await ensureSchema();
    const jobs = await getDb().select().from(aiJobs).orderBy(desc(aiJobs.createdAt)).limit(100);
    return Response.json({ jobs: jobs.map((job) => ({ ...job, sourceReferences: JSON.parse(job.sourceReferencesJson || "[]"), output: job.outputJson ? JSON.parse(job.outputJson) : null, humanCorrection: job.humanCorrection ? JSON.parse(job.humanCorrection) : null, sourceReferencesJson: undefined, outputJson: undefined })) });
  } catch {
    return Response.json({ error: "AI activity is temporarily unavailable." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = await request.json() as { action?: unknown; caseId?: unknown; documentId?: unknown; facts?: unknown };
    const action = typeof body.action === "string" ? body.action : "";
    const task = actionTask[action];
    if (!task || !body.facts || typeof body.facts !== "object" || Array.isArray(body.facts)) return Response.json({ error: "A supported assistant action and grounded facts are required." }, { status: 400 });
    const caseId = typeof body.caseId === "string" ? body.caseId : undefined;
    const documentId = typeof body.documentId === "string" ? body.documentId : undefined;
    const facts = { ...(body.facts as Record<string, unknown>), caseId: caseId ?? (body.facts as Record<string, unknown>).caseId };
    const result = await runAiTask<RecoveryPlanOutput | CommunicationDraftOutput | EvidenceSummaryOutput | PortfolioBriefingOutput | CaseCopilotOutput>({ type: task, caseId, documentId, input: facts });
    if (!result.output) return Response.json({ error: result.safeMessage ?? "Assistant output requires manual review.", ai: result }, { status: 422 });
    const db = getDb();
    if (task === "recovery_plan" && caseId) await db.insert(recoveryPlans).values({ id: crypto.randomUUID(), caseId, planJson: JSON.stringify(result.output), aiJobId: result.jobId, status: "suggested" });
    if (task === "communication_draft" && caseId) {
      const draft = result.output as CommunicationDraftOutput;
      await db.insert(communicationDrafts).values({ id: crypto.randomUUID(), caseId, draftType: draft.draftType, subject: draft.subject, body: draft.body, aiJobId: result.jobId, status: "generated" });
    }
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), caseId: caseId ?? null, documentId: documentId ?? null, eventType: `AI_${task.toUpperCase()}_GENERATED`, actor: "ai-assistant", detailJson: JSON.stringify({ jobId: result.jobId, promptVersion: result.promptVersion, provider: result.provider, consequentialActionTaken: false }) });
    return Response.json({ output: result.output, ai: { jobId: result.jobId, status: result.status, provider: result.provider, model: result.model, promptVersion: result.promptVersion, confidence: result.confidence, sourceReferences: result.sourceReferences, latencyMs: result.latencyMs } });
  } catch (error) {
    console.error(JSON.stringify({ message: "assistant workflow failed", category: "ASSISTANT_WORKFLOW_ERROR" }));
    return Response.json({ error: error instanceof Error && error.message.includes("required") ? error.message : "The assistant workflow could not be completed." }, { status: 500 });
  }
}
