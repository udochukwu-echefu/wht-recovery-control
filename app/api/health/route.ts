import { getAiConfig } from "@/db";
import { apiError, requireContext } from "@/lib/auth";
import { getActiveRuleSet } from "@/lib/rules";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    const config = getAiConfig();
    const deepSeekActive = config.mode === "deepseek" || (config.mode === "auto" && Boolean(config.apiKey));
    const demoFallback = config.mode === "demo";
    let activeRuleVersion: string | null = null;
    try { activeRuleVersion = (await getActiveRuleSet(context)).version; } catch { /* Health reports the missing control without failing. */ }
    return Response.json({ status: "ok", ai: { configured: deepSeekActive || demoFallback, provider: deepSeekActive ? "Managed AI" : demoFallback ? "Deterministic demo" : "Manual review", model: deepSeekActive ? config.model : demoFallback ? "pilot-fixtures-v1" : "unconfigured", demoFallback }, controls: { activeRuleVersion, ruleApprovalRequired: !activeRuleVersion, humanApprovalRequired: true, deterministicMatching: true }, workspace: { id: context.workspace.id, role: context.workspace.role } });
  } catch (error) {
    return apiError(error, "Service health is unavailable.");
  }
}
