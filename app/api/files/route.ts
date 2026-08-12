import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { evidenceDocuments } from "@/db/schema";
import { apiError, auditStatement, requireContext } from "@/lib/auth";
import { deleteStoredObject, getStoredObject } from "@/lib/storage";

export const runtime = "edge";

async function findDocument(workspaceId: string, documentId: string) {
  return (await getDb().select().from(evidenceDocuments).where(and(
    eq(evidenceDocuments.id, documentId), eq(evidenceDocuments.workspaceId, workspaceId), isNull(evidenceDocuments.deletedAt),
  )).limit(1))[0] ?? null;
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request);
    const documentId = new URL(request.url).searchParams.get("documentId")?.trim() ?? "";
    if (!documentId) return Response.json({ error: "documentId is required." }, { status: 400 });
    const document = await findDocument(context.workspace.id, documentId);
    if (!document) return Response.json({ error: "Document not found." }, { status: 404 });
    const object = await getStoredObject(context, document.storageKey);
    if (!object) return Response.json({ error: "Stored document bytes are unavailable." }, { status: 404 });
    const bytes = object.bytes instanceof ArrayBuffer ? object.bytes : new Uint8Array(object.bytes).buffer;
    return new Response(bytes, {
      headers: {
        "content-type": document.mimeType,
        "content-length": String(document.sizeBytes),
        "content-disposition": `attachment; filename="${document.fileName.replaceAll('"', "")}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error, "The document could not be downloaded.");
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const context = await requireContext(request, ["admin"]);
    const documentId = new URL(request.url).searchParams.get("documentId")?.trim() ?? "";
    if (!documentId) return Response.json({ error: "documentId is required." }, { status: 400 });
    const document = await findDocument(context.workspace.id, documentId);
    if (!document) return Response.json({ error: "Document not found." }, { status: 404 });
    const deletedAt = new Date().toISOString();
    await deleteStoredObject(context, document.storageKey);
    await getDb().update(evidenceDocuments).set({ deletedAt, status: "deleted" }).where(and(eq(evidenceDocuments.id, documentId), eq(evidenceDocuments.workspaceId, context.workspace.id)));
    await auditStatement(context, { eventType: "DOCUMENT_DELETED", documentId, detail: { fileName: document.fileName, sha256: document.sha256, deletedAt } }).run();
    return Response.json({ documentId, deletedAt });
  } catch (error) {
    return apiError(error, "The document could not be deleted.");
  }
}
