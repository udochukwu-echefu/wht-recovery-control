import { desc } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { evidenceDocuments, recoveryCases } from "@/db/schema";

export const runtime = "edge";

export async function GET() {
  try {
    await ensureSchema();
    const db = getDb();
    const [cases, documents] = await Promise.all([
      db.select().from(recoveryCases).orderBy(desc(recoveryCases.updatedAt)).limit(500),
      db.select({ id: evidenceDocuments.id, name: evidenceDocuments.fileName, rows: evidenceDocuments.rowCount, status: evidenceDocuments.status, createdAt: evidenceDocuments.createdAt }).from(evidenceDocuments).orderBy(desc(evidenceDocuments.createdAt)).limit(20),
    ]);
    return Response.json({ cases, documents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected database error.";
    console.error(JSON.stringify({ message: "case list failed", error: message }));
    return Response.json({ error: "Persistent case data is unavailable." }, { status: 500 });
  }
}
