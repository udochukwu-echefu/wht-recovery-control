import { and, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { clients, evidenceDocuments, recoveryCases } from "@/db/schema";
import { apiError, requireContext } from "@/lib/auth";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    const db = getDb();
    const [cases, documents, client] = await Promise.all([
      db.select({ ...getTableColumns(recoveryCases), authorityConnected: sql<number>`EXISTS (SELECT 1 FROM authority_allocations a WHERE a.case_id = ${recoveryCases.id} AND a.workspace_id = ${context.workspace.id} AND a.result_code IN ('matched','matched_within_tolerance'))` }).from(recoveryCases)
        .where(and(eq(recoveryCases.workspaceId, context.workspace.id), eq(recoveryCases.clientId, context.clientId), isNull(recoveryCases.deletedAt)))
        .orderBy(desc(recoveryCases.updatedAt)).limit(500),
      db.select({ id: evidenceDocuments.id, name: evidenceDocuments.fileName, rows: evidenceDocuments.rowCount, status: evidenceDocuments.status, createdAt: evidenceDocuments.createdAt })
        .from(evidenceDocuments)
        .where(and(eq(evidenceDocuments.workspaceId, context.workspace.id), eq(evidenceDocuments.clientId, context.clientId), isNull(evidenceDocuments.deletedAt)))
        .orderBy(desc(evidenceDocuments.createdAt)).limit(20),
      db.select({ tin: clients.tin }).from(clients).where(and(eq(clients.id, context.clientId), eq(clients.workspaceId, context.workspace.id))).limit(1),
    ]);
    return Response.json({ cases: cases.map((item) => ({ ...item, clientTin: client[0]?.tin ?? "" })), documents, workspace: context.workspace, clientId: context.clientId });
  } catch (error) {
    return apiError(error, "Persistent case data is unavailable.");
  }
}
