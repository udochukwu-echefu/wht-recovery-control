import { getD1 } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { apiError, auditStatement, requireContext } from "@/lib/auth";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request);
    const result = await getD1().prepare("SELECT * FROM rule_sets WHERE workspace_id = ? ORDER BY effective_start DESC, created_at DESC LIMIT 100")
      .bind(context.workspace.id).all();
    return Response.json({ rules: result.results, canApprove: ["admin", "practitioner"].includes(context.workspace.role) });
  } catch (error) {
    return apiError(error, "Rule sets could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request, ["admin", "practitioner"]);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "create");
    const note = String(body.note ?? "").trim();
    if (note.length < 10) return Response.json({ error: "A practitioner note of at least 10 characters is required." }, { status: 400 });
    const d1 = getD1();
    const now = new Date().toISOString();

    if (action === "approve") {
      const ruleSetId = String(body.ruleSetId ?? "").trim();
      const rule = await d1.prepare("SELECT * FROM rule_sets WHERE id = ? AND workspace_id = ? LIMIT 1").bind(ruleSetId, context.workspace.id).first<Record<string, unknown>>();
      if (!rule) return Response.json({ error: "Rule set not found." }, { status: 404 });
      if (rule.status === "approved") return Response.json({ error: "This rule set is already approved." }, { status: 409 });
      await d1.batch([
        d1.prepare("UPDATE rule_sets SET status = 'approved', approved_by_user_id = ?, approved_at = ? WHERE id = ? AND workspace_id = ?")
          .bind(context.user.id, now, ruleSetId, context.workspace.id),
        d1.prepare("INSERT INTO rule_approvals (id, workspace_id, rule_set_id, approver_user_id, role, decision, note, created_at) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?)")
          .bind(crypto.randomUUID(), context.workspace.id, ruleSetId, context.user.id, context.workspace.role, note, now),
        d1.prepare("INSERT INTO rule_change_history (id, workspace_id, rule_set_id, change_type, before_json, after_json, changed_by_user_id, reason, created_at) VALUES (?, ?, ?, 'approval', ?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), context.workspace.id, ruleSetId, JSON.stringify(rule), JSON.stringify({ ...rule, status: "approved", approved_by_user_id: context.user.id, approved_at: now }), context.user.id, note, now),
        auditStatement(context, { eventType: "RULE_SET_APPROVED", detail: { ruleSetId, version: rule.version, note } }),
      ]);
      return Response.json({ ruleSetId, status: "approved", approvedAt: now });
    }

    const version = String(body.version ?? "").trim();
    const effectiveStart = String(body.effectiveStart ?? "").trim();
    const amountKobo = Number(body.amountToleranceKobo ?? 10_000);
    const categories = Array.isArray(body.applicabilityCategories) ? body.applicabilityCategories.map(String).filter(Boolean) : [];
    if (!/^\d{4}\.\d{2}(?:\.\d+)?$/.test(version) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveStart)) return Response.json({ error: "Provide a version such as 2026.08 and a valid effective date." }, { status: 400 });
    if (!Number.isInteger(amountKobo) || amountKobo < 0 || amountKobo > 10_000_000) return Response.json({ error: "Amount tolerance must be a valid non-negative kobo amount." }, { status: 400 });
    const ruleSetId = crypto.randomUUID();
    const record = { version, effectiveStart, effectiveEnd: body.effectiveEnd || null, clientId: body.clientSpecific ? context.clientId : null, jurisdiction: String(body.jurisdiction ?? "federal"), amountKobo, categories, note };
    await d1.batch([
      d1.prepare("INSERT INTO rule_sets (id, workspace_id, version, status, effective_start, effective_end, client_id, jurisdiction, tolerances_json, applicability_categories_json, practitioner_notes, change_reason, created_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(ruleSetId, context.workspace.id, version, effectiveStart, record.effectiveEnd, record.clientId, record.jurisdiction, JSON.stringify({ amountKobo }), JSON.stringify(categories), note, note, now),
      d1.prepare("INSERT INTO rule_change_history (id, workspace_id, rule_set_id, change_type, before_json, after_json, changed_by_user_id, reason, created_at) VALUES (?, ?, ?, 'created', NULL, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), context.workspace.id, ruleSetId, JSON.stringify(record), context.user.id, note, now),
      auditStatement(context, { eventType: "RULE_SET_CREATED", detail: { ruleSetId, ...record } }),
    ]);
    return Response.json({ ruleSetId, status: "draft", version }, { status: 201 });
  } catch (error) {
    return apiError(error, "The rule-set action could not be completed.");
  }
}
