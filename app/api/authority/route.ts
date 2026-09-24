import { and, desc, eq } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { authorityRecords, receiptAllocations, receiptRecords, recoveryCases } from "@/db/schema";
import { assertMachineOutcomeTransition, nextActionForRecoveryCase } from "@/lib/case-stage-policy";
import { apiError, auditStatement, requireContext } from "@/lib/auth";
import { getActiveRuleSet } from "@/lib/rules";

export const runtime = "edge";

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const MAX_FREE_TIER_AUTHORITY_RECORDS = 15;

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    const rows = await getDb().select().from(authorityRecords).where(and(eq(authorityRecords.workspaceId, context.workspace.id), eq(authorityRecords.clientId, context.clientId))).orderBy(desc(authorityRecords.createdAt)).limit(250);
    return Response.json({ records: rows });
  } catch (error) {
    return apiError(error, "Authority records could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireContext(request, ["admin", "practitioner", "reviewer"]);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "import");
    const now = new Date().toISOString();
    const d1 = getD1();

    if (action === "import") {
      const records = Array.isArray(body.records) ? body.records : [];
      if (!records.length || records.length > MAX_FREE_TIER_AUTHORITY_RECORDS) return Response.json({ error: `Provide between 1 and ${MAX_FREE_TIER_AUTHORITY_RECORDS} authority records per zero-cost synchronous import. Split larger batches before retrying.` }, { status: 400 });
      const created: string[] = [];
      const seen = new Set<string>();
      const statements = [];
      for (const raw of records) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Response.json({ error: "Each authority record must be an object." }, { status: 400 });
        const item = raw as Record<string, unknown>;
        const reference = String(item.recordReference ?? "").trim();
        const authorityType = String(item.authorityType ?? "FIRS credit ledger").trim();
        const jurisdiction = String(item.jurisdiction ?? "federal").trim();
        const beneficiaryTin = String(item.beneficiaryTin ?? "").trim();
        const deductingCustomerTin = String(item.deductingCustomerTin ?? "").trim();
        const reportingPeriod = String(item.reportingPeriod ?? "").trim();
        const creditStatus = String(item.creditStatus ?? "available").trim();
        const amountKobo = Number(item.amountKobo);
        if (!reference || !beneficiaryTin || !deductingCustomerTin || !reportingPeriod || !Number.isInteger(amountKobo) || amountKobo <= 0) return Response.json({ error: "Each authority record requires reference, both TINs, period, and a positive kobo amount." }, { status: 400 });
        if (reference.length > 120 || authorityType.length > 80 || jurisdiction.length > 40 || beneficiaryTin.length > 40 || deductingCustomerTin.length > 40 || reportingPeriod.length > 80) return Response.json({ error: "Authority record fields exceed the supported lengths." }, { status: 400 });
        if (!["available", "utilised", "recognized", "recognised", "reversed", "cancelled"].includes(creditStatus.toLowerCase())) return Response.json({ error: `Authority record ${reference} has an unsupported credit status.` }, { status: 400 });
        const identity = `${normalise(authorityType)}:${normalise(reference)}`;
        if (seen.has(identity)) return Response.json({ error: `Duplicate authority record in request: ${reference}.` }, { status: 409 });
        seen.add(identity);
        const exists = await d1.prepare("SELECT id FROM authority_records WHERE workspace_id = ? AND client_id = ? AND authority_type = ? AND record_reference = ? LIMIT 1").bind(context.workspace.id, context.clientId, authorityType, reference).first();
        if (exists) return Response.json({ error: `Authority record ${reference} has already been imported.` }, { status: 409 });
        const id = crypto.randomUUID();
        created.push(id);
        statements.push(d1.prepare("INSERT INTO authority_records (id, workspace_id, client_id, authority_type, jurisdiction, record_reference, beneficiary_tin, deducting_customer_tin, amount_kobo, reporting_period, filing_date, credit_status, verification_state, verified_by_user_id, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reviewed', ?, ?, ?)")
          .bind(id, context.workspace.id, context.clientId, authorityType, jurisdiction, reference, beneficiaryTin, deductingCustomerTin, amountKobo, reportingPeriod, item.filingDate ? String(item.filingDate) : null, creditStatus, context.user.id, now, now));
      }
      statements.push(auditStatement(context, { eventType: "AUTHORITY_RECORDS_IMPORTED", detail: { count: created.length, recordIds: created } }));
      await d1.batch(statements);
      return Response.json({ imported: created.length, recordIds: created }, { status: 201 });
    }

    if (action !== "reconcile") return Response.json({ error: "Unsupported authority action." }, { status: 400 });
    const caseId = String(body.caseId ?? "").trim();
    const authorityRecordId = String(body.authorityRecordId ?? "").trim();
    const note = String(body.note ?? "").trim();
    if (!caseId || !authorityRecordId || note.length < 10) return Response.json({ error: "Case, authority record, and a note of at least 10 characters are required." }, { status: 400 });
    const recoveryCase = (await getDb().select().from(recoveryCases).where(and(eq(recoveryCases.id, caseId), eq(recoveryCases.workspaceId, context.workspace.id), eq(recoveryCases.clientId, context.clientId))).limit(1))[0];
    const authority = (await getDb().select().from(authorityRecords).where(and(eq(authorityRecords.id, authorityRecordId), eq(authorityRecords.workspaceId, context.workspace.id), eq(authorityRecords.clientId, context.clientId))).limit(1))[0];
    if (!recoveryCase || !authority) return Response.json({ error: "Case or authority record not found." }, { status: 404 });
    const receiptAllocation = (await getDb().select().from(receiptAllocations).where(and(eq(receiptAllocations.caseId, caseId), eq(receiptAllocations.workspaceId, context.workspace.id))).orderBy(desc(receiptAllocations.createdAt)).limit(1))[0];
    if (!receiptAllocation) return Response.json({ error: "Attach and review a WHT receipt before authority reconciliation." }, { status: 409 });
    const receipt = (await getDb().select().from(receiptRecords).where(and(eq(receiptRecords.id, receiptAllocation.receiptId), eq(receiptRecords.workspaceId, context.workspace.id), eq(receiptRecords.clientId, context.clientId))).limit(1))[0];
    if (!receipt) return Response.json({ error: "The allocated receipt record is unavailable." }, { status: 409 });
    if (receipt.status !== "reviewed") return Response.json({ error: "Complete the receipt extraction review before authority reconciliation." }, { status: 409 });
    const rules = await getActiveRuleSet(context, recoveryCase.businessDate ?? undefined);
    const latestMatch = await d1.prepare("SELECT id, document_id, rule_version, result_json FROM match_executions WHERE workspace_id = ? AND case_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .bind(context.workspace.id, caseId).first<{ id: string; document_id: string; rule_version: string; result_json: string }>();
    let latestMatchResult: { exceptionCode?: unknown } = {};
    try { latestMatchResult = latestMatch ? JSON.parse(latestMatch.result_json) as { exceptionCode?: unknown } : {}; } catch { /* Malformed history fails closed below. */ }
    if (!latestMatch || latestMatch.document_id !== receipt.documentId || latestMatch.rule_version !== rules.version || latestMatchResult.exceptionCode !== "NO_OPEN_EXCEPTION") {
      return Response.json({ error: "Authority reconciliation requires a current, fully reviewed deterministic receipt match with no open exception." }, { status: 409 });
    }
    const existingReconciliation = await d1.prepare(`SELECT id FROM authority_allocations
      WHERE workspace_id = ? AND authority_record_id = ? AND receipt_allocation_id = ?
        AND result_code IN ('matched', 'matched_within_tolerance') LIMIT 1`)
      .bind(context.workspace.id, authorityRecordId, receiptAllocation.id).first();
    if (existingReconciliation) return Response.json({ error: "This receipt allocation is already reconciled to the selected authority credit." }, { status: 409 });
    const otherAllocated = await d1.prepare(`SELECT COALESCE(SUM(amount_kobo), 0) AS amount_kobo FROM authority_allocations
      WHERE workspace_id = ? AND authority_record_id = ?
        AND result_code IN ('matched', 'matched_within_tolerance')`)
      .bind(context.workspace.id, authorityRecordId).first<{ amount_kobo: number }>();
    const authorityRemainingKobo = authority.amountKobo - (otherAllocated?.amount_kobo ?? 0);
    if (receiptAllocation.amountKobo > authorityRemainingKobo) return Response.json({ error: "This reconciliation would allocate more than the authority credit's remaining balance." }, { status: 409 });
    const checks = {
      beneficiaryTin: { receipt: receipt.beneficiaryTin, authority: authority.beneficiaryTin, pass: Boolean(receipt.beneficiaryTin && normalise(receipt.beneficiaryTin) === normalise(authority.beneficiaryTin)) },
      deductingCustomerTin: { receipt: receipt.deductingCustomerTin, authority: authority.deductingCustomerTin, pass: Boolean(receipt.deductingCustomerTin && normalise(receipt.deductingCustomerTin) === normalise(authority.deductingCustomerTin)) },
      amount: { receiptKobo: receiptAllocation.amountKobo, authorityRemainingKobo, authorityOriginalKobo: authority.amountKobo, toleranceKobo: rules.toleranceAmountKobo, pass: Math.abs(receiptAllocation.amountKobo - authorityRemainingKobo) <= rules.toleranceAmountKobo },
      reportingPeriod: { receipt: receipt.reportingPeriod, authority: authority.reportingPeriod, pass: Boolean(receipt.reportingPeriod && normalise(receipt.reportingPeriod) === normalise(authority.reportingPeriod)) },
      creditStatus: { authority: authority.creditStatus, pass: ["available", "recognized", "recognised"].includes(authority.creditStatus.toLowerCase()) },
    };
    const passed = Object.values(checks).every((check) => check.pass);
    const resultCode = passed ? (receiptAllocation.amountKobo === authorityRemainingKobo ? "matched" : "matched_within_tolerance") : "mismatch";
    const nextStage = assertMachineOutcomeTransition(recoveryCase.stage, passed ? "matched" : "in-dispute");
    const exceptionCode = passed ? "NO_OPEN_EXCEPTION" : "AUTHORITY_MISMATCH";
    const nextAction = nextActionForRecoveryCase({ stage: nextStage, exceptionCode, authorityConnected: passed, hasReceipt: true });
    const allocationId = crypto.randomUUID();
    await d1.batch([
      d1.prepare("INSERT INTO authority_allocations (id, workspace_id, authority_record_id, case_id, receipt_allocation_id, match_execution_id, amount_kobo, result_code, result_json, rule_version, verified_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(allocationId, context.workspace.id, authorityRecordId, caseId, receiptAllocation.id, latestMatch.id, Math.min(receiptAllocation.amountKobo, authorityRemainingKobo), resultCode, JSON.stringify({ checks, note, matchExecutionId: latestMatch.id }), rules.version, context.user.id, now),
      auditStatement(context, { caseId, documentId: receipt.documentId, eventType: passed ? "AUTHORITY_RECORD_CONNECTED" : "AUTHORITY_RECONCILIATION_FAILED", detail: { allocationId, authorityRecordId, matchExecutionId: latestMatch.id, resultCode, checks, ruleVersion: rules.version, note } }),
      d1.prepare("UPDATE recovery_cases SET stage = ?, exception_code = ?, next_action = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND client_id = ?")
        .bind(nextStage, exceptionCode, nextAction, now, caseId, context.workspace.id, context.clientId),
      d1.prepare("UPDATE receipt_allocations SET status = ? WHERE id = ? AND workspace_id = ?").bind(passed ? "confirmed" : "disputed", receiptAllocation.id, context.workspace.id),
    ]);
    return Response.json({ caseId, allocationId, resultCode, checks, recognitionEligible: passed, authorityRemainingKobo: authorityRemainingKobo - (passed ? receiptAllocation.amountKobo : 0) });
  } catch (error) {
    return apiError(error, "The authority workflow could not be completed.");
  }
}
