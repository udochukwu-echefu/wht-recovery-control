import { getD1 } from "@/db";
import type { RequestContext } from "@/lib/auth";
import { ApiError } from "@/lib/auth";

export type StoredObject = {
  storageKey: string;
  bytes: ArrayBuffer | number[];
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
};

const MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  csv: ["text/csv", "application/vnd.ms-excel", "text/plain"],
  txt: ["text/plain"],
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
};

export async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "evidence";
}

function hasExpectedSignature(bytes: Uint8Array, extension: string) {
  if (extension === "pdf") return bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (extension === "png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (extension === "jpg" || extension === "jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === "webp") return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  return true;
}

export function validateUpload(file: File, bytes: ArrayBuffer) {
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const allowedMimes = MIME_BY_EXTENSION[extension];
  if (!allowedMimes) throw new ApiError(415, "Use CSV for ledgers, or TXT, PDF, PNG, JPEG, or WebP for evidence.");
  const mime = file.type || (extension === "csv" ? "text/csv" : "application/octet-stream");
  if (file.type && !allowedMimes.includes(file.type)) throw new ApiError(415, "The file extension and content type do not agree.");
  if (!hasExpectedSignature(new Uint8Array(bytes), extension)) throw new ApiError(415, "The file signature does not match its extension.");
  return { extension, mime, isLedger: extension === "csv", isText: extension === "txt" || extension === "csv" };
}

export async function putStoredObject(context: RequestContext, file: File, bytes: ArrayBuffer) {
  const d1 = getD1();
  const settings = await d1.prepare("SELECT max_file_bytes, max_storage_bytes, retention_days FROM workspace_settings WHERE workspace_id = ?")
    .bind(context.workspace.id).first<{ max_file_bytes: number; max_storage_bytes: number; retention_days: number }>();
  if (!settings) throw new ApiError(409, "Workspace storage settings are missing.");
  if (bytes.byteLength < 1 || bytes.byteLength > settings.max_file_bytes) throw new ApiError(413, `File must be between 1 byte and ${Math.floor(settings.max_file_bytes / 1_048_576)} MB.`);

  const sha256 = await sha256Hex(bytes);
  const duplicate = await d1.prepare("SELECT id, file_name FROM evidence_documents WHERE workspace_id = ? AND sha256 = ? AND deleted_at IS NULL LIMIT 1")
    .bind(context.workspace.id, sha256).first<{ id: string; file_name: string }>();
  if (duplicate) throw new ApiError(409, `This file is already stored as ${duplicate.file_name}.`);

  const usage = await d1.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM evidence_blobs WHERE workspace_id = ? AND deleted_at IS NULL")
    .bind(context.workspace.id).first<{ bytes: number }>();
  if ((usage?.bytes ?? 0) + bytes.byteLength > settings.max_storage_bytes) throw new ApiError(413, "Workspace document storage quota has been reached. Remove retained documents or ask an administrator to raise the limit.");

  const documentId = crypto.randomUUID();
  const storageKey = `${context.workspace.id}/${new Date().toISOString().slice(0, 10)}/${documentId}-${safeFileName(file.name)}`;
  const contentType = file.type || "application/octet-stream";
  await d1.prepare("INSERT INTO evidence_blobs (storage_key, workspace_id, bytes, content_type, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(storageKey, context.workspace.id, bytes, contentType, bytes.byteLength, sha256, new Date().toISOString()).run();
  return { documentId, storageKey, sha256, contentType, retentionDays: settings.retention_days };
}

export async function getStoredObject(context: RequestContext, storageKey: string) {
  return getD1().prepare(`SELECT storage_key, bytes, content_type, size_bytes, sha256, created_at
    FROM evidence_blobs WHERE storage_key = ? AND workspace_id = ? AND deleted_at IS NULL LIMIT 1`)
    .bind(storageKey, context.workspace.id).first<StoredObject>();
}

export async function getStoredObjectText(context: RequestContext, storageKey: string) {
  const row = await getStoredObject(context, storageKey);
  if (!row) return null;
  const bytes = row.bytes instanceof ArrayBuffer ? new Uint8Array(row.bytes) : new Uint8Array(row.bytes);
  return new TextDecoder().decode(bytes);
}

export async function deleteStoredObject(context: RequestContext, storageKey: string) {
  const now = new Date().toISOString();
  const result = await getD1().prepare("UPDATE evidence_blobs SET deleted_at = ? WHERE storage_key = ? AND workspace_id = ? AND deleted_at IS NULL")
    .bind(now, storageKey, context.workspace.id).run();
  return (result.meta.changes ?? 0) > 0;
}
