import { and, desc, eq } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { authorityRecords, receiptAllocations, receiptRecords, recoveryCases } from "@/db/schema";
import { apiError, auditStatement, requireContext } from "@/lib/auth";
import { getActiveRuleSet } from "@/lib/rules";

export const runtime = "edge";

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request);
    const rows = await getDb().select().from(authorityRecords).where(eq(authorityRecords.workspaceId, context.workspace.id)).orderBy(desc(authorityRecords.createdAt)).limit(250);
    return Response.json({ records: rows });
  } catch (error) {
    return apiError(error, "Authority records could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request, ["admin", "practitioner", "reviewer"]);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "import");
    const now = new Date().toISOString();
    const d1 = getD1();

    if (action === "import") {
      const records = Array.isArray(body.records) ? body.records : [];
      if (!records.length || records.length > 500) return Response.json({ error: "Provide between 1 and 500 authority records." }, { status: 400 });
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
        const identity = `${normalise(authorityType)}:${normalise(reference)}`;
        if (seen.has(identity)) return Response.json({ error: `Duplicate authority record in request: ${reference}.` }, { status: 409 });
        seen.add(identity);
        const exists = await d1.prepare("SELECT id FROM authority_records WHERE workspace_id = ? AND authority_type = ? AND record_reference = ? LIMIT 1").bind(context.workspace.id, authorityType, reference).first();
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
    const recoveryCase = (await getDb().select().from(recoveryCases).where(and(eq(recoveryCases.id, caseId), eq(recoveryCases.workspaceId, context.workspace.id))).limit(1))[0];
    const authority = (await getDb().select().from(authorityRecords).where(and(eq(authorityRecords.id, authorityRecordId), eq(authorityRecords.workspaceId, context.workspace.id))).limit(1))[0];
    if (!recoveryCase || !authority) return Response.json({ error: "Case or authority record not found." }, { status: 404 });
    const receiptAllocation = (await getDb().select().from(receiptAllocations).where(and(eq(receiptAllocations.caseId, caseId), eq(receiptAllocations.workspaceId, context.workspace.id))).orderBy(desc(receiptAllocations.createdAt)).limit(1))[0];
    if (!receiptAllocation) return Response.json({ error: "Attach and review a WHT receipt before authority reconciliation." }, { status: 409 });
    const receipt = (await getDb().select().from(receiptRecords).where(and(eq(receiptRecords.id, receiptAllocation.receiptId), eq(receiptRecords.workspaceId, context.workspace.id))).limit(1))[0];
    if (!receipt) return Response.json({ error: "The allocated receipt record is unavailable." }, { status: 409 });
    const rules = await getActiveRuleSet(context, recoveryCase.businessDate ?? undefined);
    const checks = {
      beneficiaryTin: { receipt: receipt.beneficiaryTin, authority: authority.beneficiaryTin, pass: Boolean(receipt.beneficiaryTin && normalise(receipt.beneficiaryTin) === normalise(authority.beneficiaryTin)) },
      deductingCustomerTin: { receipt: receipt.deductingCustomerTin, authority: authority.deductingCustomerTin, pass: Boolean(receipt.deductingCustomerTin && normalise(receipt.deductingCustomerTin) === normalise(authority.deductingCustomerTin)) },
      amount: { receiptKobo: receiptAllocation.amountKobo, authorityKobo: authority.amountKobo, toleranceKobo: rules.toleranceAmountKobo, pass: Math.abs(receiptAllocation.amountKobo - authority.amountKobo) <= rules.toleranceAmountKobo },
      reportingPeriod: { receipt: receipt.reportingPeriod, authority: authority.reportingPeriod, pass: Boolean(receipt.reportingPeriod && normalise(receipt.reportingPeriod) === normalise(authority.reportingPeriod)) },
      creditStatus: { authority: authority.creditStatus, pass: ["available", "utilised", "recognized", "recognised"].includes(authority.creditStatus.toLowerCase()) },
    };
    const passed = Object.values(checks).every((check) => check.pass);
    const resultCode = passed ? (receiptAllocation.amountKobo === authority.amountKobo ? "matched" : "matched_within_tolerance") : "mismatch";
    const allocationId = crypto.randomUUID();
    await d1.batch([
      d1.prepare("INSERT INTO authority_allocations (id, workspace_id, authority_record_id, case_id, receipt_allocation_id, amount_kobo, result_code, result_json, rule_version, verified_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(allocationId, context.workspace.id, authorityRecordId, caseId, receiptAllocation.id, Math.min(receiptAllocation.amountKobo, authority.amountKobo), resultCode, JSON.stringify({ checks, note }), rules.version, context.user.id, now),
      auditStatement(context, { caseId, documentId: receipt.documentId, eventType: passed ? "AUTHORITY_RECORD_CONNECTED" : "AUTHORITY_RECONCILIATION_FAILED", detail: { allocationId, authorityRecordId, resultCode, checks, ruleVersion: rules.version, note } }),
      d1.prepare("UPDATE recovery_cases SET stage = ?, exception_code = ?, next_action = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
        .bind(passed ? "matched" : "in-dispute", passed ? "NO_OPEN_EXCEPTION" : "AUTHORITY_MISMATCH", passed ? "Review and recognise credit" : "Resolve authority mismatch", now, caseId, context.workspace.id),
      d1.prepare("UPDATE receipt_allocations SET status = ? WHERE id = ? AND workspace_id = ?").bind(passed ? "confirmed" : "disputed", receiptAllocation.id, context.workspace.id),
    ]);
    return Response.json({ caseId, allocationId, resultCode, checks, recognitionEligible: passed });
  } catch (error) {
    return apiError(error, "The authority workflow could not be completed.");
  }
}
