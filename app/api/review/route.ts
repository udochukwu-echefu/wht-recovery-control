import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ensureSchema } from "@/db/ensure";
import { auditEvents, recoveryCases } from "@/db/schema";

export const runtime = "edge";
const allowedStages = new Set(["detected", "evidence-needed", "matched", "in-dispute", "recognised", "closed"]);

function isReviewPayload(value: unknown): value is { caseId: string; stage: string; note?: string } {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.caseId === "string" && typeof payload.stage === "string" && (payload.note === undefined || typeof payload.note === "string");
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const payload: unknown = await request.json();
    if (!isReviewPayload(payload) || !allowedStages.has(payload.stage)) return Response.json({ error: "A valid caseId and stage are required." }, { status: 400 });
    const db = getDb();
    const existing = await db.select({ id: recoveryCases.id }).from(recoveryCases).where(eq(recoveryCases.id, payload.caseId)).limit(1);
    if (!existing.length) return Response.json({ error: "Case not found." }, { status: 404 });
    const now = new Date().toISOString();
    await db.update(recoveryCases).set({ stage: payload.stage, updatedAt: now }).where(eq(recoveryCases.id, payload.caseId));
    await db.insert(auditEvents).values({ id: crypto.randomUUID(), caseId: payload.caseId, eventType: "REVIEW_DECISION", actor: "reviewer", detailJson: JSON.stringify({ stage: payload.stage, note: payload.note?.trim().slice(0, 500) ?? "" }) });
    return Response.json({ caseId: payload.caseId, stage: payload.stage, updatedAt: now });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected review error.";
    console.error(JSON.stringify({ message: "review failed", error: message }));
    return Response.json({ error: "The review decision could not be saved." }, { status: 500 });
  }
}
