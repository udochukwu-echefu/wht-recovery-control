import { eq } from "drizzle-orm";
import { getAiConfig, getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { aiJobs } from "@/db/schema";
import type { AiTaskDefinition, AiTaskResult, AiTaskType } from "./contracts.ts";
import { getAiTaskDefinition } from "./definitions.ts";
import { selectAiProvider } from "./providers.ts";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  return value;
}

export async function hashStructuredInput(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function runAiTask<TOutput>({
  type,
  input,
  caseId,
  documentId,
  workspaceId = "pilot-workspace",
  requestedByUserId,
  providerMode,
}: {
  type: AiTaskType;
  input: Record<string, unknown>;
  caseId?: string;
  documentId?: string;
  workspaceId?: string;
  requestedByUserId?: string;
  providerMode?: string;
}): Promise<AiTaskResult<TOutput>> {
  await ensureSchema();
  const config = getAiConfig();
  const provider = selectAiProvider({ mode: providerMode || config.mode, apiKey: config.apiKey, model: config.model });
  const definition = getAiTaskDefinition(type) as AiTaskDefinition<Record<string, unknown>, TOutput>;
  const jobId = crypto.randomUUID();
  const inputHash = await hashStructuredInput(input);
  const createdAt = new Date().toISOString();
  const db = getDb();
  await db.insert(aiJobs).values({ id: jobId, workspaceId, caseId, documentId, taskType: type, status: "processing", provider: provider.name, model: provider.model, promptVersion: definition.promptVersion, inputHash, validationOutcome: "pending", requestedByUserId, idempotencyKey: `${workspaceId}:${type}:${inputHash}`, attemptCount: 1, createdAt });
  const started = Date.now();
  try {
    const raw = await provider.generateStructured(definition, input);
    const output = definition.validateOutput(raw.output, input);
    const latencyMs = Date.now() - started;
    const confidence = definition.confidence(output);
    const sourceReferences = definition.sourceReferences(input, output);
    const completedAt = new Date().toISOString();
    await db.update(aiJobs).set({ status: "completed", outputJson: JSON.stringify(output), confidence, sourceReferencesJson: JSON.stringify(sourceReferences), latencyMs, validationOutcome: "validated", completedAt }).where(eq(aiJobs.id, jobId));
    return { jobId, status: "completed", provider: provider.name, model: provider.model, promptVersion: definition.promptVersion, output, confidence, sourceReferences, latencyMs, validationOutcome: "validated" };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : error instanceof Error && /unknown field|missing|must be|invalid|not allowed|cannot/.test(error.message) ? "OUTPUT_VALIDATION_FAILED" : "AI_TASK_FAILED";
    const manual = code === "AI_MANUAL_REVIEW" || code === "PROVIDER_TIMEOUT" || code === "OUTPUT_VALIDATION_FAILED";
    const safeMessage = manual ? (error instanceof Error ? error.message.slice(0, 300) : "Continue with manual review.") : "AI assistance could not complete this task. Continue with manual review or retry.";
    await db.update(aiJobs).set({ status: manual ? "manual_review" : "failed", latencyMs, validationOutcome: manual ? "manual_review" : "rejected", errorCode: code, errorMessage: safeMessage, completedAt: new Date().toISOString() }).where(eq(aiJobs.id, jobId));
    if (manual) return { jobId, status: "manual_review", provider: provider.name, model: provider.model, promptVersion: definition.promptVersion, output: null, confidence: null, sourceReferences: [], latencyMs, validationOutcome: "manual_review", safeMessage };
    throw Object.assign(new Error(safeMessage), { code });
  }
}
