import { getOpenAIConfig } from "@/db";

export const runtime = "edge";

export async function GET() {
  const config = getOpenAIConfig();
  return Response.json({ status: "ok", ai: { configured: Boolean(config.apiKey), model: config.model }, controls: { ruleVersion: "2026.07", humanApprovalRequired: true } });
}
