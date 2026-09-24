import { getD1 } from "@/db";
import type { RequestContext } from "@/lib/auth";
import { ApiError } from "@/lib/auth";

export type ActiveRuleSet = {
  id: string;
  version: string;
  toleranceAmountKobo: number;
  applicabilityCategories: string[];
  practitionerNotes: string;
};

export async function getActiveRuleSet(context: RequestContext, businessDate = new Date().toISOString().slice(0, 10)): Promise<ActiveRuleSet> {
  const row = await getD1().prepare(`
    SELECT id, version, tolerances_json, applicability_categories_json, practitioner_notes
    FROM rule_sets
    WHERE workspace_id = ? AND status = 'approved'
      AND effective_start <= ? AND (effective_end IS NULL OR effective_end >= ?)
      AND (client_id IS NULL OR client_id = ?)
    ORDER BY CASE WHEN client_id = ? THEN 0 ELSE 1 END, effective_start DESC, created_at DESC
    LIMIT 1
  `).bind(context.workspace.id, businessDate, businessDate, context.clientId, context.clientId).first<{
    id: string; version: string; tolerances_json: string; applicability_categories_json: string; practitioner_notes: string;
  }>();
  if (!row) throw new ApiError(409, "An approved rule set is required for this business date. Ask an administrator or practitioner to review Rules & controls.");
  let tolerances: Record<string, unknown>;
  let applicabilityCategories: string[];
  try {
    tolerances = JSON.parse(row.tolerances_json || "{}") as Record<string, unknown>;
    const parsedCategories: unknown = JSON.parse(row.applicability_categories_json || "[]");
    if (!Array.isArray(parsedCategories) || parsedCategories.some((item) => typeof item !== "string")) throw new Error("Invalid category list");
    applicabilityCategories = parsedCategories;
  } catch {
    throw new ApiError(409, "The active rule set is malformed and must be replaced before processing cases.");
  }
  const toleranceAmountKobo = Number(tolerances.amountKobo ?? 10_000);
  if (!Number.isInteger(toleranceAmountKobo) || toleranceAmountKobo < 0 || toleranceAmountKobo > 10_000_000 || !applicabilityCategories.length) throw new ApiError(409, "The active rule set contains invalid tolerance or applicability controls.");
  return {
    id: row.id,
    version: row.version,
    toleranceAmountKobo,
    applicabilityCategories,
    practitionerNotes: row.practitioner_notes,
  };
}
