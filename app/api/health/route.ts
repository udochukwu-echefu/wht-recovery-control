import { getDeepSeekConfig } from "@/db";

export const runtime = "edge";

export async function GET() {
  const config = getDeepSeekConfig();
  return Response.json({ status: "ok", ai: { configured: Boolean(config.apiKey), provider: "DeepSeek", model: config.model, release: "V4 Flash 0731" }, controls: { ruleVersion: "2026.07", humanApprovalRequired: true } });
}
