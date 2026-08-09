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

export function getEvidenceBucket() {
  if (!env.EVIDENCE) {
    throw new Error("Cloudflare R2 binding `EVIDENCE` is unavailable.");
  }
  return env.EVIDENCE;
}

export function getOpenAIConfig() {
  return {
    apiKey: env.OPENAI_API_KEY?.trim() ?? "",
    model: env.OPENAI_MODEL?.trim() || "gpt-5.6",
  };
}
