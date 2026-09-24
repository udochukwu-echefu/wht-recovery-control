import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiJobs, auditEvents, authorityAllocations, clients, communicationDrafts, correspondenceEvents, evidenceDocuments, extractedFields, matchExecutions, recoveryCases, recoveryPlans } from "@/db/schema";
import type { AiTaskType, CaseCopilotOutput, CommunicationDraftOutput, EvidenceSummaryOutput, PortfolioBriefingOutput, RecoveryPlanOutput } from "@/lib/ai/contracts";
import { runAiTask } from "@/lib/ai/service";
import { apiError, auditStatement, enforceRateLimit, requireContext, type RequestContext } from "@/lib/auth";

export const runtime = "edge";

const actionTask: Record<string, AiTaskType> = {
  "recovery-plan": "recovery_plan",
  "communication-draft": "communication_draft",
  "evidence-summary": "evidence_summary",
  "portfolio-briefing": "portfolio_briefing",
  copilot: "case_copilot",
};

async function groundCase(context: RequestContext, caseId: string) {
  const db = getDb();
  const recoveryCase = (await db.select().from(recoveryCases).where(and(eq(recoveryCases.id, caseId), eq(recoveryCases.workspaceId, context.workspace.id), eq(recoveryCases.clientId, context.clientId))).limit(1))[0];
  if (!recoveryCase) return null;
  const [fields, events, correspondence, documents, client, latestMatch, authority] = await Promise.all([
    recoveryCase.sourceDocumentId ? db.select().from(extractedFields).where(and(eq(extractedFields.documentId, recoveryCase.sourceDocumentId), eq(extractedFields.workspaceId, context.workspace.id))) : [],
    db.select({ eventType: auditEvents.eventType, detailJson: auditEvents.detailJson, createdAt: auditEvents.createdAt }).from(auditEvents).where(and(eq(auditEvents.caseId, caseId), eq(auditEvents.workspaceId, context.workspace.id))).orderBy(desc(auditEvents.createdAt)).limit(50),
    db.select().from(correspondenceEvents).where(and(eq(correspondenceEvents.caseId, caseId), eq(correspondenceEvents.workspaceId, context.workspace.id))).orderBy(desc(correspondenceEvents.occurredAt)).limit(20),
    recoveryCase.sourceDocumentId ? db.select({ id: evidenceDocuments.id, fileName: evidenceDocuments.fileName, kind: evidenceDocuments.kind, status: evidenceDocuments.status, sha256: evidenceDocuments.sha256 }).from(evidenceDocuments).where(and(eq(evidenceDocuments.id, recoveryCase.sourceDocumentId), eq(evidenceDocuments.workspaceId, context.workspace.id), eq(evidenceDocuments.clientId, context.clientId))) : [],
    db.select({ tin: clients.tin, legalName: clients.legalName }).from(clients).where(and(eq(clients.id, recoveryCase.clientId), eq(clients.workspaceId, context.workspace.id))).limit(1),
    db.select({ resultJson: matchExecutions.resultJson, ruleVersion: matchExecutions.ruleVersion, createdAt: matchExecutions.createdAt }).from(matchExecutions).where(and(eq(matchExecutions.caseId, caseId), eq(matchExecutions.workspaceId, context.workspace.id))).orderBy(desc(matchExecutions.createdAt)).limit(1),
    db.select({ resultCode: authorityAllocations.resultCode, resultJson: authorityAllocations.resultJson, ruleVersion: authorityAllocations.ruleVersion, createdAt: authorityAllocations.createdAt }).from(authorityAllocations).where(and(eq(authorityAllocations.caseId, caseId), eq(authorityAllocations.workspaceId, context.workspace.id))).orderBy(desc(authorityAllocations.createdAt)).limit(1),
  ]);
  return {
    caseId: recoveryCase.id,
    customer: recoveryCase.customer,
    customerTin: recoveryCase.customerTin,
    invoiceReference: recoveryCase.invoiceReference,
    invoiceGrossKobo: recoveryCase.invoiceGrossKobo,
    paymentNetKobo: recoveryCase.paymentNetKobo,
    expectedWhtKobo: recoveryCase.expectedWhtKobo,
    reportingPeriod: recoveryCase.reportingPeriod,
    stage: recoveryCase.stage,
    exceptionCode: recoveryCase.exceptionCode,
    applicabilityStatus: recoveryCase.applicabilityStatus,
    nextAction: recoveryCase.nextAction,
    priority: recoveryCase.priority,
    dueDate: recoveryCase.dueDate,
    ruleVersion: recoveryCase.ruleVersion,
    approvedEntity: { legalName: client[0]?.legalName ?? "", beneficiaryTin: client[0]?.tin ?? "", configured: Boolean(client[0]?.tin) },
    effectiveExtractedFields: fields.map((field) => ({ fieldName: field.fieldName, value: field.reviewedValue ?? field.extractedValue, confidence: field.confidence, sourceQuote: field.evidenceQuote, pageNumber: field.pageNumber, reviewed: field.reviewedValue !== null })),
    evidenceDocuments: documents,
    latestDeterministicMatch: latestMatch[0] ? { result: JSON.parse(latestMatch[0].resultJson || "{}"), ruleVersion: latestMatch[0].ruleVersion, createdAt: latestMatch[0].createdAt } : null,
    authorityReconciliation: authority[0] ? { resultCode: authority[0].resultCode, result: JSON.parse(authority[0].resultJson || "{}"), ruleVersion: authority[0].ruleVersion, createdAt: authority[0].createdAt } : null,
    auditHistory: events.map((event) => ({ eventType: event.eventType, createdAt: event.createdAt, detail: JSON.parse(event.detailJson || "{}") })),
    correspondence: correspondence.map((event) => ({ direction: event.direction, channel: event.channel, eventType: event.eventType, subject: event.subject, occurredAt: event.occurredAt })),
  };
}

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    const jobs = await getDb().select().from(aiJobs).where(and(eq(aiJobs.workspaceId, context.workspace.id), eq(aiJobs.clientId, context.clientId))).orderBy(desc(aiJobs.createdAt)).limit(100);
    return Response.json({ jobs: jobs.map((job) => ({ ...job, sourceReferences: JSON.parse(job.sourceReferencesJson || "[]"), output: job.outputJson ? JSON.parse(job.outputJson) : null, humanCorrection: job.humanCorrection ? JSON.parse(job.humanCorrection) : null, sourceReferencesJson: undefined, outputJson: undefined })) });
  } catch (error) {
    return apiError(error, "AI activity is temporarily unavailable.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireContext(request, ["admin", "practitioner", "reviewer", "analyst"]);
    await enforceRateLimit(context, "assistant", 20, 60);
    const body = await request.json() as { action?: unknown; caseId?: unknown; documentId?: unknown; question?: unknown; draftType?: unknown };
    const action = typeof body.action === "string" ? body.action : "";
    const task = actionTask[action];
    if (!task) return Response.json({ error: "A supported assistant action is required." }, { status: 400 });
    const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
    const requestedDocumentId = typeof body.documentId === "string" ? body.documentId.trim() : undefined;
    let documentId: string | undefined;
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
    if (task === "case_copilot" && !question) return Response.json({ error: "Enter a question about this case." }, { status: 400 });
    let input: Record<string, unknown>;
    if (task === "portfolio_briefing") {
      const cases = await getDb().select().from(recoveryCases).where(and(eq(recoveryCases.workspaceId, context.workspace.id), eq(recoveryCases.clientId, context.clientId))).orderBy(desc(recoveryCases.updatedAt)).limit(500);
      input = { cases: cases.map((item) => ({ id: item.id, customer: item.customer, amountKobo: item.expectedWhtKobo, stage: item.stage, exceptionCode: item.exceptionCode, priority: item.priority, dueDate: item.dueDate, nextAction: item.nextAction })) };
    } else {
      if (!caseId) return Response.json({ error: "caseId is required for this assistant action." }, { status: 400 });
      const grounded = await groundCase(context, caseId);
      if (!grounded) return Response.json({ error: "Case not found." }, { status: 404 });
      const groundedDocumentIds = new Set(grounded.evidenceDocuments.map((document) => document.id));
      if (requestedDocumentId && !groundedDocumentIds.has(requestedDocumentId)) return Response.json({ error: "The requested document is not evidence for this case in the active client scope." }, { status: 400 });
      documentId = requestedDocumentId || grounded.evidenceDocuments[0]?.id;
      input = { ...grounded, question: question || undefined, draftType: typeof body.draftType === "string" ? body.draftType.slice(0, 80) : undefined };
    }
    const result = await runAiTask<RecoveryPlanOutput | CommunicationDraftOutput | EvidenceSummaryOutput | PortfolioBriefingOutput | CaseCopilotOutput>({ type: task, caseId: caseId || undefined, documentId, workspaceId: context.workspace.id, clientId: context.clientId, requestedByUserId: context.user.id, input });
    if (!result.output) return Response.json({ error: result.safeMessage ?? "Assistant output requires manual review.", ai: result }, { status: 422 });
    const db = getDb();
    let artifactId: string | null = null;
    if (task === "recovery_plan" && caseId) await db.insert(recoveryPlans).values({ id: crypto.randomUUID(), workspaceId: context.workspace.id, caseId, planJson: JSON.stringify(result.output), aiJobId: result.jobId, status: "suggested" });
    if (task === "communication_draft" && caseId) {
      const draft = result.output as CommunicationDraftOutput;
      const prior = await db.select({ version: communicationDrafts.version }).from(communicationDrafts).where(and(eq(communicationDrafts.workspaceId, context.workspace.id), eq(communicationDrafts.caseId, caseId))).orderBy(desc(communicationDrafts.version)).limit(1);
      artifactId = crypto.randomUUID();
      await db.insert(communicationDrafts).values({ id: artifactId, workspaceId: context.workspace.id, caseId, draftType: draft.draftType, subject: draft.subject, body: draft.body, aiJobId: result.jobId, status: "generated", version: (prior[0]?.version ?? 0) + 1, sourceSnapshotJson: JSON.stringify(input) });
    }
    await auditStatement(context, { caseId: caseId || null, documentId: documentId ?? null, eventType: `AI_${task.toUpperCase()}_GENERATED`, actor: "ai-assistant", detail: { jobId: result.jobId, promptVersion: result.promptVersion, provider: result.provider, consequentialActionTaken: false, sourceGroundedOnServer: true } }).run();
    return Response.json({ output: result.output, artifact: artifactId ? { id: artifactId, type: "communication_draft" } : null, ai: { jobId: result.jobId, status: result.status, provider: result.provider, model: result.model, promptVersion: result.promptVersion, confidence: result.confidence, sourceReferences: result.sourceReferences, latencyMs: result.latencyMs } });
  } catch (error) {
    return apiError(error, "The assistant workflow could not be completed.");
  }
}
