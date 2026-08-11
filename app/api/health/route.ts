import { getAiConfig } from "@/db";

export const runtime = "edge";

export async function GET() {
  const config = getAiConfig();
  const deepSeekActive = config.mode === "deepseek" || (config.mode === "auto" && Boolean(config.apiKey));
  const demoFallback = config.mode === "demo" || (config.mode === "auto" && !config.apiKey);
  return Response.json({ status: "ok", ai: { configured: config.mode !== "manual", provider: deepSeekActive ? "Managed AI" : demoFallback ? "Deterministic demo" : "Manual review", model: deepSeekActive ? config.model : demoFallback ? "pilot-fixtures-v1" : "unconfigured", demoFallback }, controls: { ruleVersion: "2026.07", humanApprovalRequired: true, deterministicMatching: true } });
}
