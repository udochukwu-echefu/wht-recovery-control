import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditEvents } from "@/db/schema";
import { apiError, requireContext } from "@/lib/auth";

export const runtime = "edge";

export async function GET(request: Request) {
  const caseId = new URL(request.url).searchParams.get("caseId")?.trim();
  if (!caseId) return Response.json({ error: "caseId is required." }, { status: 400 });
  try {
    await ensureSchema();
    const context = await requireContext(request);
    const rows = await getDb().select().from(auditEvents).where(and(eq(auditEvents.workspaceId, context.workspace.id), eq(auditEvents.caseId, caseId))).orderBy(desc(auditEvents.createdAt)).limit(100);
    return Response.json({ events: rows });
  } catch (error) {
    return apiError(error, "Audit history is unavailable.");
  }
}
