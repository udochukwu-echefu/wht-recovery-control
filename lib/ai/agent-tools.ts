import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { caseSources, evidenceDocuments, matchExecutions, recoveryCases } from "@/db/schema";
import type { RequestContext } from "@/lib/auth";
import { recoveryCaseStages } from "@/lib/case-stage-policy";
import { parsePortfolioToolArguments, proposalToolActions } from "./agent-tool-contracts";
import { actionDescription, assistantApproverRoles, validateActionPayload, type ActionPayload } from "./action-contracts";
import type { PortfolioAgentToolResult } from "./agent-tool-contracts";

export { portfolioAgentTools, parsePortfolioToolArguments } from "./agent-tool-contracts";

function caseFacts(item: typeof recoveryCases.$inferSelect) {
  return {
    id: item.id,
    customer: item.customer,
    invoiceReference: item.invoiceReference,
    expectedWhtKobo: item.expectedWhtKobo,
    expectedWht: formatWht(item.expectedWhtKobo),
    stage: item.stage,
    exceptionCode: item.exceptionCode,
    confidence: item.confidence,
    priority: item.priority,
    nextAction: item.nextAction,
    dueDate: item.dueDate,
    reportingPeriod: item.reportingPeriod,
    ruleVersion: item.ruleVersion,
    updatedAt: item.updatedAt,
    assignedOwnerId: item.assignedOwnerId,
    ownerRole: item.ownerRole,
  };
}

function formatWht(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function scopedCase(context: RequestContext, caseId: string) {
  return (await getDb().select().from(recoveryCases).where(and(
    eq(recoveryCases.id, caseId),
    eq(recoveryCases.workspaceId, context.workspace.id),
    eq(recoveryCases.clientId, context.clientId),
    sql`${recoveryCases.deletedAt} is null`,
  )).limit(1))[0];
}

function safeRecordedJson(value: string) {
  try { return JSON.parse(value.slice(0, 8_000)) as unknown; }
  catch { return { warning: "The recorded result could not be read in full." }; }
}

export async function executePortfolioAgentTool(context: RequestContext, name: string, rawArguments: string): Promise<PortfolioAgentToolResult> {
  const args = parsePortfolioToolArguments(name, rawArguments);
  const db = getDb();
  if (name === "list_workspace_members") {
    const members = await getD1().prepare(`SELECT u.id, u.display_name AS name, m.role FROM users u
      JOIN workspace_memberships m ON m.user_id = u.id AND m.status = 'active'
      WHERE m.workspace_id = ? AND u.status = 'active' AND m.role IN ('admin', 'practitioner', 'reviewer', 'analyst')
      ORDER BY u.display_name, u.id LIMIT 51`).bind(context.workspace.id).all<{ id: string; name: string; role: string }>();
    return { data: { members: members.results.slice(0, 50), truncated: members.results.length > 50 }, sourceLabels: ["workspace.members"], detail: `${Math.min(members.results.length, 50)} available owners` };
  }
  if (name === "portfolio_summary") {
    const rows = await db.select({
      stage: recoveryCases.stage,
      count: sql<number>`count(*)`,
      expectedWhtKobo: sql<number>`coalesce(sum(${recoveryCases.expectedWhtKobo}), 0)`,
    }).from(recoveryCases).where(and(
      eq(recoveryCases.workspaceId, context.workspace.id),
      eq(recoveryCases.clientId, context.clientId),
      sql`${recoveryCases.deletedAt} is null`,
    )).groupBy(recoveryCases.stage);
    const caseCount = rows.reduce((sum, row) => sum + row.count, 0);
    const expectedWhtKobo = rows.reduce((sum, row) => sum + row.expectedWhtKobo, 0);
    return { data: { stages: rows.map((row) => ({ ...row, expectedWht: formatWht(row.expectedWhtKobo) })), caseCount, expectedWhtKobo, expectedWht: formatWht(expectedWhtKobo) }, sourceLabels: ["portfolio.current"], detail: `${caseCount} cases` };
  }
  if (name === "search_cases") {
    const { query, stage } = args as { query: string; stage?: string };
    const pattern = `%${query}%`;
    const rows = await db.select().from(recoveryCases).where(and(
      eq(recoveryCases.workspaceId, context.workspace.id),
      eq(recoveryCases.clientId, context.clientId),
      sql`${recoveryCases.deletedAt} is null`,
      stage ? eq(recoveryCases.stage, stage as (typeof recoveryCaseStages)[number]) : undefined,
      query ? or(like(recoveryCases.customer, pattern), like(recoveryCases.invoiceReference, pattern), like(recoveryCases.id, pattern)) : undefined,
    )).orderBy(desc(recoveryCases.updatedAt)).limit(11);
    return { data: { cases: rows.slice(0, 10).map(caseFacts), truncated: rows.length > 10 }, sourceLabels: ["portfolio.current"], detail: `${Math.min(rows.length, 10)} cases${rows.length > 10 ? " (more available)" : ""}` };
  }
  const { caseId } = args as { caseId: string };
  const item = await scopedCase(context, caseId);
  if (!item) return { data: { found: false, caseId }, sourceLabels: ["portfolio.current"], detail: "Case not found in this client" };
  if (name === "get_case") return { data: { found: true, case: caseFacts(item) }, sourceLabels: [`case:${caseId}`], detail: item.customer };
  if (name === "get_case_evidence") {
    const linked = await db.select({
      id: evidenceDocuments.id,
      fileName: evidenceDocuments.fileName,
      kind: evidenceDocuments.kind,
      status: evidenceDocuments.status,
      createdAt: evidenceDocuments.createdAt,
    }).from(caseSources).innerJoin(evidenceDocuments, eq(caseSources.documentId, evidenceDocuments.id)).where(and(
      eq(caseSources.caseId, caseId),
      eq(caseSources.workspaceId, context.workspace.id),
      eq(evidenceDocuments.workspaceId, context.workspace.id),
      eq(evidenceDocuments.clientId, context.clientId),
      sql`${evidenceDocuments.deletedAt} is null`,
    )).limit(20);
    if (item.sourceDocumentId && !linked.some((row) => row.id === item.sourceDocumentId)) {
      const source = (await db.select({
        id: evidenceDocuments.id,
        fileName: evidenceDocuments.fileName,
        kind: evidenceDocuments.kind,
        status: evidenceDocuments.status,
        createdAt: evidenceDocuments.createdAt,
      }).from(evidenceDocuments).where(and(
        eq(evidenceDocuments.id, item.sourceDocumentId),
        eq(evidenceDocuments.workspaceId, context.workspace.id),
        eq(evidenceDocuments.clientId, context.clientId),
        sql`${evidenceDocuments.deletedAt} is null`,
      )).limit(1))[0];
      if (source) linked.push(source);
    }
    return { data: { caseId, documents: linked }, sourceLabels: [`case:${caseId}:evidence`], detail: `${linked.length} documents` };
  }
  const actionType = proposalToolActions[name];
  if (actionType) {
    if (!(assistantApproverRoles as readonly string[]).includes(context.workspace.role)) throw new Error("This role cannot prepare action proposals.");
    const { caseId: _caseId, ...effects } = args as Record<string, unknown>;
    void _caseId;
    let payload: ActionPayload;
    const sourceLabels = [`case:${caseId}`];
    if (actionType === "case_note") payload = { body: `AI-drafted note: ${String(effects.note)}` };
    else if (actionType === "case_assignment") {
      const owner = await getD1().prepare(`SELECT u.id, u.display_name AS name, m.role FROM users u
        JOIN workspace_memberships m ON m.user_id = u.id AND m.status = 'active'
        WHERE u.id = ? AND m.workspace_id = ? AND u.status = 'active' AND m.role IN ('admin', 'practitioner', 'reviewer', 'analyst') LIMIT 1`)
        .bind(effects.ownerId, context.workspace.id).first<{ id: string; name: string; role: string }>();
      if (!owner) throw new Error("The proposed owner is unavailable in this workspace.");
      payload = { ownerId: owner.id, ownerName: owner.name, ownerRole: owner.role };
      sourceLabels.push("workspace.members");
    } else payload = validateActionPayload(actionType, effects);
    return {
      data: { caseId, customer: item.customer, actionType, proposedEffects: payload, description: actionDescription(actionType, payload), state: "awaiting_human_approval", caseUpdatedAt: item.updatedAt },
      sourceLabels,
      detail: `Proposal for ${item.customer}; no case change made`,
      proposal: { actionType, caseId, caseUpdatedAt: item.updatedAt, payload, customer: item.customer },
    };
  }
  const latest = (await db.select().from(matchExecutions).where(and(
    eq(matchExecutions.caseId, caseId),
    eq(matchExecutions.workspaceId, context.workspace.id),
  )).orderBy(desc(matchExecutions.createdAt)).limit(1))[0];
  return {
    data: latest ? { caseId, ruleVersion: latest.ruleVersion, result: safeRecordedJson(latest.resultJson), conflicts: safeRecordedJson(latest.conflictsJson), checkedAt: latest.createdAt } : { caseId, result: null, note: "No deterministic match execution is recorded for this case." },
    sourceLabels: [`case:${caseId}:checks`],
    detail: latest ? `Rule ${latest.ruleVersion}` : "No recorded match",
  };
}
