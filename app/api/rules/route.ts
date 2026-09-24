import { getD1 } from "@/db";
import { apiError, auditStatement, requireContext } from "@/lib/auth";

export const runtime = "edge";

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    const result = await getD1().prepare("SELECT * FROM rule_sets WHERE workspace_id = ? AND (client_id IS NULL OR client_id = ?) ORDER BY effective_start DESC, created_at DESC LIMIT 100")
      .bind(context.workspace.id, context.clientId).all();
    return Response.json({ rules: result.results, canApprove: ["admin", "practitioner"].includes(context.workspace.role) });
  } catch (error) {
    return apiError(error, "Rule sets could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
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
      if (typeof rule.client_id === "string" && rule.client_id !== context.clientId) return Response.json({ error: "Rule set not found in the active client scope." }, { status: 404 });
      if (rule.status === "approved") return Response.json({ error: "This rule set is already approved." }, { status: 409 });
      const ruleClientId = typeof rule.client_id === "string" ? rule.client_id : null;
      const ruleEffectiveStart = typeof rule.effective_start === "string" ? rule.effective_start : "";
      const ruleEffectiveEnd = typeof rule.effective_end === "string" ? rule.effective_end : null;
      const overlap = await d1.prepare(`SELECT id FROM rule_sets
        WHERE workspace_id = ? AND status = 'approved' AND id <> ?
          AND COALESCE(client_id, '') = COALESCE(?, '')
          AND effective_start <= COALESCE(?, '9999-12-31')
          AND COALESCE(effective_end, '9999-12-31') >= ?
        LIMIT 1`).bind(context.workspace.id, ruleSetId, ruleClientId, ruleEffectiveEnd, ruleEffectiveStart).first();
      if (overlap) return Response.json({ error: "This rule set overlaps an already approved rule for the same client scope." }, { status: 409 });
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
    const effectiveEnd = body.effectiveEnd ? String(body.effectiveEnd).trim() : null;
    const amountKobo = Number(body.amountToleranceKobo ?? 10_000);
    const categories = Array.isArray(body.applicabilityCategories) ? [...new Set(body.applicabilityCategories.map((item) => String(item).trim()).filter(Boolean))] : [];
    if (!/^\d{4}\.\d{2}(?:\.\d+)?$/.test(version) || !isValidIsoDate(effectiveStart) || (effectiveEnd !== null && (!isValidIsoDate(effectiveEnd) || effectiveEnd < effectiveStart))) return Response.json({ error: "Provide a version such as 2026.08 and a valid effective date range." }, { status: 400 });
    if (!Number.isInteger(amountKobo) || amountKobo < 0 || amountKobo > 10_000_000) return Response.json({ error: "Amount tolerance must be a valid non-negative kobo amount." }, { status: 400 });
    if (!categories.length || categories.length > 30 || categories.some((category) => category.length > 80)) return Response.json({ error: "Provide between 1 and 30 concise applicability categories." }, { status: 400 });
    const ruleSetId = crypto.randomUUID();
    const jurisdiction = String(body.jurisdiction ?? "federal").trim();
    if (!["federal", "state", "mixed"].includes(jurisdiction)) return Response.json({ error: "Rule jurisdiction must be federal, state or mixed." }, { status: 400 });
    const clientId = body.clientSpecific ? context.clientId : null;
    const duplicate = await d1.prepare("SELECT id FROM rule_sets WHERE workspace_id = ? AND version = ? AND COALESCE(client_id, '') = COALESCE(?, '') LIMIT 1").bind(context.workspace.id, version, clientId).first();
    if (duplicate) return Response.json({ error: "That rule version already exists for this client scope." }, { status: 409 });
    const record = { version, effectiveStart, effectiveEnd, clientId, jurisdiction, amountKobo, categories, note };
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
