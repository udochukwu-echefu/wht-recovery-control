import { and, desc, eq } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { applicabilityReviews, recoveryCases } from "@/db/schema";
import { apiError, auditStatement, requireContext } from "@/lib/auth";
import { getActiveRuleSet } from "@/lib/rules";

export const runtime = "edge";

const outcomes = new Set(["applicable", "not_applicable", "exempt", "uncertain"]);

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request);
    const caseId = new URL(request.url).searchParams.get("caseId")?.trim() ?? "";
    if (!caseId) return Response.json({ error: "caseId is required." }, { status: 400 });
    const rows = await getDb().select().from(applicabilityReviews).where(and(eq(applicabilityReviews.workspaceId, context.workspace.id), eq(applicabilityReviews.caseId, caseId))).orderBy(desc(applicabilityReviews.createdAt)).limit(20);
    return Response.json({ reviews: rows });
  } catch (error) {
    return apiError(error, "Applicability reviews could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request, ["admin", "practitioner", "reviewer"]);
    const body = await request.json() as Record<string, unknown>;
    const caseId = String(body.caseId ?? "").trim();
    const outcome = String(body.outcome ?? "").trim();
    const note = String(body.note ?? "").trim();
    const category = String(body.transactionCategory ?? "").trim();
    if (!caseId || !outcomes.has(outcome)) return Response.json({ error: "caseId and a supported applicability outcome are required." }, { status: 400 });
    if (note.length < 10) return Response.json({ error: "A review note of at least 10 characters is required." }, { status: 400 });
    if (!category) return Response.json({ error: "Transaction category is required." }, { status: 400 });
    const recoveryCase = (await getDb().select().from(recoveryCases).where(and(eq(recoveryCases.id, caseId), eq(recoveryCases.workspaceId, context.workspace.id))).limit(1))[0];
    if (!recoveryCase) return Response.json({ error: "Case not found." }, { status: 404 });
    if (["recognised", "closed", "non-recoverable"].includes(recoveryCase.stage)) return Response.json({ error: "Applicability cannot be changed after a terminal outcome." }, { status: 409 });
    const rules = await getActiveRuleSet(context, recoveryCase.businessDate ?? undefined);
    const expectedRateBps = body.expectedRateBps === null || body.expectedRateBps === undefined ? null : Number(body.expectedRateBps);
    const confirmedExpectedKobo = body.confirmedExpectedKobo === null || body.confirmedExpectedKobo === undefined ? recoveryCase.expectedWhtKobo : Number(body.confirmedExpectedKobo);
    if (expectedRateBps !== null && (!Number.isInteger(expectedRateBps) || expectedRateBps < 0 || expectedRateBps > 10_000)) return Response.json({ error: "Expected rate must be between 0 and 10,000 basis points." }, { status: 400 });
    if (!Number.isInteger(confirmedExpectedKobo) || confirmedExpectedKobo < 0) return Response.json({ error: "Confirmed WHT must be a valid non-negative kobo amount." }, { status: 400 });
    if (["not_applicable", "exempt"].includes(outcome) && !String(body.exemptionReason ?? "").trim()) return Response.json({ error: "An exemption or non-applicability reason is required." }, { status: 400 });
    const now = new Date().toISOString();
    const reviewId = crypto.randomUUID();
    const applicabilityStatus = outcome === "applicable" ? "confirmed_applicable" : outcome === "uncertain" ? "uncertain" : "not_applicable";
    const stage = outcome === "applicable" ? "evidence-needed" : outcome === "uncertain" ? "detected" : "non-recoverable";
    const exceptionCode = outcome === "applicable" ? "RECEIPT_MISSING" : outcome === "uncertain" ? "APPLICABILITY_UNCERTAIN" : outcome === "exempt" ? "WHT_EXEMPT" : "WHT_NOT_APPLICABLE";
    const nextAction = outcome === "applicable" ? "Attach WHT receipt" : outcome === "uncertain" ? "Escalate applicability review" : null;
    const d1 = getD1();
    await d1.batch([
      d1.prepare("INSERT INTO applicability_reviews (id, workspace_id, case_id, calculated_gap_kobo, outcome, transaction_category, expected_rate_bps, confirmed_expected_kobo, exemption_reason, reviewer_note, reviewer_user_id, reviewer_display_name, rule_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(reviewId, context.workspace.id, caseId, recoveryCase.invoiceGrossKobo - recoveryCase.paymentNetKobo, outcome, category, expectedRateBps, confirmedExpectedKobo, String(body.exemptionReason ?? "").trim() || null, note, context.user.id, context.user.displayName, rules.version, now),
      auditStatement(context, { caseId, documentId: recoveryCase.sourceDocumentId, eventType: "APPLICABILITY_REVIEW_COMPLETED", detail: { reviewId, outcome, category, expectedRateBps, confirmedExpectedKobo, ruleVersion: rules.version, note } }),
      d1.prepare("UPDATE recovery_cases SET applicability_status = ?, expected_wht_kobo = ?, stage = ?, exception_code = ?, rule_version = ?, next_action = ?, updated_at = ? WHERE id = ? AND workspace_id = ?")
        .bind(applicabilityStatus, confirmedExpectedKobo, stage, exceptionCode, rules.version, nextAction, now, caseId, context.workspace.id),
    ]);
    return Response.json({ caseId, reviewId, applicabilityStatus, stage, exceptionCode, nextAction, ruleVersion: rules.version });
  } catch (error) {
    return apiError(error, "The applicability review could not be saved.");
  }
}
