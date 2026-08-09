import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditEvents } from "@/db/schema";

export const runtime = "edge";

export async function GET(request: Request) {
  const caseId = new URL(request.url).searchParams.get("caseId")?.trim();
  if (!caseId) return Response.json({ error: "caseId is required." }, { status: 400 });
  try {
    await ensureSchema();
    const rows = await getDb().select().from(auditEvents).where(eq(auditEvents.caseId, caseId)).orderBy(desc(auditEvents.createdAt)).limit(100);
    return Response.json({ events: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected audit error.";
    console.error(JSON.stringify({ message: "audit read failed", error: message }));
    return Response.json({ error: "Audit history is unavailable." }, { status: 500 });
  }
}
