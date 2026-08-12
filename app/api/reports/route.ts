import { getD1 } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { apiError, requireContext } from "@/lib/auth";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request);
    const d1 = getD1();
    const params = new URL(request.url).searchParams;
    const from = params.get("from") || "1900-01-01";
    const to = params.get("to") || "2999-12-31";
    const [summary, ageing, outcomes, activities] = await Promise.all([
      d1.prepare(`SELECT stage, COUNT(*) AS case_count, COALESCE(SUM(expected_wht_kobo), 0) AS amount_kobo
        FROM recovery_cases WHERE workspace_id = ? AND client_id = ? AND deleted_at IS NULL AND substr(created_at,1,10) BETWEEN ? AND ? GROUP BY stage ORDER BY amount_kobo DESC`)
        .bind(context.workspace.id, context.clientId, from, to).all(),
      d1.prepare(`SELECT CASE WHEN age_days <= 30 THEN '0-30' WHEN age_days <= 60 THEN '31-60' WHEN age_days <= 90 THEN '61-90' ELSE '90+' END AS bucket,
          COUNT(*) AS case_count, COALESCE(SUM(expected_wht_kobo),0) AS amount_kobo
        FROM (SELECT expected_wht_kobo, CAST(julianday('now') - julianday(substr(created_at,1,10)) AS INTEGER) AS age_days
          FROM recovery_cases WHERE workspace_id = ? AND client_id = ? AND stage NOT IN ('closed','non-recoverable','written-off') AND deleted_at IS NULL)
        GROUP BY bucket ORDER BY MIN(age_days)`)
        .bind(context.workspace.id, context.clientId).all(),
      d1.prepare("SELECT outcome_type, COUNT(*) AS outcome_count, COALESCE(SUM(amount_kobo),0) AS amount_kobo FROM case_outcomes WHERE workspace_id = ? AND effective_date BETWEEN ? AND ? GROUP BY outcome_type ORDER BY amount_kobo DESC")
        .bind(context.workspace.id, from, to).all(),
      d1.prepare("SELECT event_type, COUNT(*) AS event_count FROM audit_events WHERE workspace_id = ? AND substr(created_at,1,10) BETWEEN ? AND ? GROUP BY event_type ORDER BY event_count DESC LIMIT 50")
        .bind(context.workspace.id, from, to).all(),
    ]);
    return Response.json({ filters: { from, to, workspaceId: context.workspace.id, clientId: context.clientId }, generatedAt: new Date().toISOString(), summary: summary.results, ageing: ageing.results, outcomes: outcomes.results, activities: activities.results });
  } catch (error) {
    return apiError(error, "Recovery reporting is unavailable.");
  }
}
