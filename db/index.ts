import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export function getD1() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return env.DB;
}

export async function putEvidenceObject(storageKey: string, bytes: ArrayBuffer, contentType: string) {
  await getD1()
    .prepare("INSERT INTO evidence_blobs (storage_key, bytes, content_type) VALUES (?, ?, ?)")
    .bind(storageKey, bytes, contentType)
    .run();
}

export async function getEvidenceObjectText(storageKey: string) {
  const row = await getD1()
    .prepare("SELECT bytes FROM evidence_blobs WHERE storage_key = ? LIMIT 1")
    .bind(storageKey)
    .first<{ bytes: ArrayBuffer | number[] }>();
  if (!row) return null;
  const bytes = row.bytes instanceof ArrayBuffer ? new Uint8Array(row.bytes) : new Uint8Array(row.bytes);
  return new TextDecoder().decode(bytes);
}

export async function deleteEvidenceObject(storageKey: string) {
  await getD1().prepare("DELETE FROM evidence_blobs WHERE storage_key = ?").bind(storageKey).run();
}

export function getDeepSeekConfig() {
  return {
    apiKey: env.DEEPSEEK_API_KEY?.trim() ?? "",
    model: env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash",
  };
}

export function getAiConfig() {
  const deepSeek = getDeepSeekConfig();
  return {
    ...deepSeek,
    mode: env.AI_PROVIDER?.trim().toLowerCase() || "auto",
  };
}
