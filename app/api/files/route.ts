import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { evidenceDocuments } from "@/db/schema";
import { apiError, requireContext } from "@/lib/auth";
import { getStoredObject, safeFileName, sha256Hex } from "@/lib/storage";

export const runtime = "edge";

async function findDocument(workspaceId: string, clientId: string, documentId: string) {
  return (await getDb().select().from(evidenceDocuments).where(and(
    eq(evidenceDocuments.id, documentId), eq(evidenceDocuments.workspaceId, workspaceId), eq(evidenceDocuments.clientId, clientId), isNull(evidenceDocuments.deletedAt),
  )).limit(1))[0] ?? null;
}

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    const documentId = new URL(request.url).searchParams.get("documentId")?.trim() ?? "";
    if (!documentId) return Response.json({ error: "documentId is required." }, { status: 400 });
    const document = await findDocument(context.workspace.id, context.clientId, documentId);
    if (!document) return Response.json({ error: "Document not found." }, { status: 404 });
    const object = await getStoredObject(context, document.storageKey);
    if (!object) return Response.json({ error: "Stored document bytes are unavailable." }, { status: 404 });
    if (object.sha256 !== document.sha256 || object.sizeBytes !== document.sizeBytes) return Response.json({ error: "Stored document integrity verification failed." }, { status: 409 });
    const bytes = object.bytes instanceof ArrayBuffer ? object.bytes : new Uint8Array(object.bytes).buffer;
    if (await sha256Hex(bytes) !== document.sha256) return Response.json({ error: "Stored document checksum verification failed." }, { status: 409 });
    return new Response(bytes, {
      headers: {
        "content-type": document.mimeType,
        "content-length": String(document.sizeBytes),
        "content-disposition": `attachment; filename="${safeFileName(document.fileName)}"`,
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
    const context = await requireContext(request, ["admin"]);
    const documentId = new URL(request.url).searchParams.get("documentId")?.trim() ?? "";
    if (!documentId) return Response.json({ error: "documentId is required." }, { status: 400 });
    const document = await findDocument(context.workspace.id, context.clientId, documentId);
    if (!document) return Response.json({ error: "Document not found." }, { status: 404 });
    const deletedAt = new Date().toISOString();
    const d1 = getD1();
    const deletionResults = await d1.batch([
      d1.prepare("UPDATE evidence_blobs SET deleted_at = ? WHERE storage_key = ? AND workspace_id = ? AND deleted_at IS NULL")
        .bind(deletedAt, document.storageKey, context.workspace.id),
      d1.prepare("UPDATE evidence_documents SET deleted_at = ?, status = 'deleted' WHERE id = ? AND workspace_id = ? AND client_id = ? AND deleted_at IS NULL")
        .bind(deletedAt, documentId, context.workspace.id, context.clientId),
      d1.prepare(`INSERT INTO audit_events (id, workspace_id, case_id, document_id, event_type, actor, actor_user_id, actor_display_name, actor_role, detail_json, created_at)
        SELECT ?, ?, NULL, ?, 'DOCUMENT_DELETED', 'user', ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM evidence_documents WHERE id = ? AND workspace_id = ? AND client_id = ? AND deleted_at = ?)`)
        .bind(crypto.randomUUID(), context.workspace.id, documentId, context.user.id, context.user.displayName, context.workspace.role, JSON.stringify({ fileName: document.fileName, sha256: document.sha256, deletedAt }), deletedAt, documentId, context.workspace.id, context.clientId, deletedAt),
    ]);
    if (!(deletionResults[1].meta.changes ?? 0)) return Response.json({ error: "The document was already deleted or changed. Reload the document list." }, { status: 409 });
    return Response.json({ documentId, deletedAt });
  } catch (error) {
    return apiError(error, "The document could not be deleted.");
  }
}
