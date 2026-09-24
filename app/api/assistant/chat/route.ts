import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { assistantConversations, assistantMessages, recoveryCases } from "@/db/schema";
import type { PortfolioBriefingOutput, PortfolioCopilotOutput } from "@/lib/ai/contracts";
import { runAiTask } from "@/lib/ai/service";
import { ApiError, apiError, auditStatement, enforceRateLimit, requireContext } from "@/lib/auth";
import { validateUpload } from "@/lib/storage";

export const runtime = "edge";

type StreamEvent =
  | { type: "status"; phase: string; label: string }
  | { type: "tool"; id: string; label: string; state: "running" | "complete"; detail?: string }
  | { type: "answer_start" }
  | { type: "answer_delta"; text: string }
  | { type: "done"; metadata: Record<string, unknown>; conversationTitle: string }
  | { type: "error"; message: string };

export async function POST(request: Request) {
  try {
    const context = await requireContext(request, ["admin", "practitioner", "reviewer", "analyst"]);
    await enforceRateLimit(context, "assistant", 20, 60);
    const form = await request.formData();
    const conversationId = String(form.get("conversationId") ?? "");
    const action = String(form.get("action") ?? "ask");
    const question = String(form.get("question") ?? "").trim().slice(0, 300);
    if (action !== "ask" && action !== "briefing") throw new ApiError(400, "Choose a supported chat action.");
    if (action === "ask" && !question) throw new ApiError(400, "Enter a question about the portfolio.");
    const db = getDb();
    const conversation = (await db.select().from(assistantConversations).where(and(
      eq(assistantConversations.id, conversationId),
      eq(assistantConversations.workspaceId, context.workspace.id),
      eq(assistantConversations.clientId, context.clientId),
      eq(assistantConversations.userId, context.user.id),
    )).limit(1))[0];
    if (!conversation) throw new ApiError(404, "Conversation not found.");
    const upload = form.get("file");
    if (upload && !(upload instanceof File)) throw new ApiError(400, "Choose one supported text attachment.");
    if (upload instanceof File && (upload.size < 1 || upload.size > 65_536)) throw new ApiError(413, "Attach a TXT or CSV file no larger than 64 KB.");

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const activity: Array<{ id: string; kind: "status" | "tool"; label: string; state: "running" | "complete"; detail?: string }> = [];
        const emit = (event: StreamEvent) => {
          if (event.type === "status") {
            for (const item of activity) if (item.kind === "status") item.state = "complete";
            const prior = activity.findIndex((item) => item.id === event.phase && item.kind === "status");
            if (prior >= 0) activity.splice(prior, 1);
            activity.push({ id: event.phase, kind: "status", label: event.label, state: "running" });
          }
          if (event.type === "tool") {
            const prior = activity.findIndex((item) => item.id === event.id && item.kind === "tool");
            if (prior >= 0) activity.splice(prior, 1);
            activity.push({ id: event.id, kind: "tool", label: event.label, state: event.state, detail: event.detail });
          }
          try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
          catch { /* The client left; finish recording the requested work. */ }
        };
        try {
          emit({ type: "status", phase: "thinking", label: "Understanding your request" });
          let attachmentText = "";
          let attachmentName = "";
          if (upload instanceof File) {
            emit({ type: "tool", id: "attachment", label: "Read text attachment", state: "running" });
            const bytes = await upload.arrayBuffer();
            if (!validateUpload(upload, bytes).isText) throw new ApiError(415, "The assistant can read TXT or CSV files. Use Data intake for PDF or image evidence.");
            try { attachmentText = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim().slice(0, 16_000); }
            catch { throw new ApiError(422, "The attachment must contain readable UTF-8 text."); }
            if (!attachmentText) throw new ApiError(422, "The attachment contains no readable text.");
            attachmentName = upload.name;
            emit({ type: "tool", id: "attachment", label: "Read text attachment", state: "complete", detail: attachmentName });
          }

          emit({ type: "tool", id: "portfolio", label: "Load current portfolio", state: "running" });
          const rows = await db.select().from(recoveryCases).where(and(
            eq(recoveryCases.workspaceId, context.workspace.id),
            eq(recoveryCases.clientId, context.clientId),
          )).orderBy(desc(recoveryCases.updatedAt)).limit(501);
          const cases = rows.slice(0, 500);
          emit({ type: "tool", id: "portfolio", label: "Load current portfolio", state: "complete", detail: `${cases.length} cases` });

          const isBriefing = action === "briefing" && !attachmentText;
          const userText = action === "briefing" ? "Create a portfolio briefing" : question;
          let input: Record<string, unknown>;
          if (isBriefing) {
            const intervention = cases.filter((item) => item.stage === "evidence-needed" || item.stage === "in-dispute");
            const largest = intervention.toSorted((a, b) => b.expectedWhtKobo - a.expectedWhtKobo)[0];
            input = {
              caseIds: cases.map((item) => item.id),
              interventionCount: intervention.length,
              interventionFormatted: `₦${(intervention.reduce((sum, item) => sum + item.expectedWhtKobo, 0) / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`,
              interventionCaseIds: intervention.map((item) => item.id),
              largestCustomer: largest?.customer ?? "No blocked case",
              largestException: largest?.exceptionCode ?? "No open exception",
              largestCaseId: largest?.id ?? "",
              dataQualityWarning: `${cases.filter((item) => item.confidence < 70).length} cases have evidence confidence below 70%.${rows.length > 500 ? " This briefing covers only the 500 most recently updated cases." : ""}`,
            };
          } else {
            const prior = await db.select({ role: assistantMessages.role, content: assistantMessages.content }).from(assistantMessages).where(eq(assistantMessages.conversationId, conversation.id)).orderBy(desc(assistantMessages.id)).limit(12);
            input = {
              question: action === "briefing" ? "Create a portfolio briefing using the current cases and attached text." : question,
              conversation: prior.reverse(),
              portfolioLimited: rows.length > 500,
              cases: cases.map((item) => ({ id: item.id, customer: item.customer, amountKobo: item.expectedWhtKobo, stage: item.stage, exceptionCode: item.exceptionCode, priority: item.priority, dueDate: item.dueDate, nextAction: item.nextAction })),
              ...(attachmentText ? { attachmentName, attachmentText } : {}),
            };
          }

          const task = isBriefing ? "portfolio_briefing" : "portfolio_copilot";
          const result = await runAiTask<PortfolioBriefingOutput | PortfolioCopilotOutput>({
            type: task,
            input,
            workspaceId: context.workspace.id,
            clientId: context.clientId,
            requestedByUserId: context.user.id,
            onProgress: (phase) => {
              if (phase === "provider") emit({ type: "status", phase: "thinking", label: "Generating a grounded response" });
              if (phase === "validation") emit({ type: "status", phase: "validating", label: "Checking sources and response structure" });
              if (phase === "recorded") emit({ type: "status", phase: "saving", label: "Recording the AI activity" });
            },
          });
          if (!result.output) throw new ApiError(422, result.safeMessage ?? "Assistant output requires manual review.");
          const output = result.output;
          const text = isBriefing ? (output as PortfolioBriefingOutput).narrative : (output as PortfolioCopilotOutput).answer;
          const baseMetadata = isBriefing
            ? { title: "Portfolio briefing draft", sourceLabels: (output as PortfolioBriefingOutput).sourceLabels, suggestedAction: (output as PortfolioBriefingOutput).dataQualityWarning, action: { label: "Review intervention cases", filter: "needs-intervention" }, aiJobId: result.jobId }
            : { ...(action === "briefing" ? { title: "Portfolio briefing draft" } : {}), sourceLabels: (output as PortfolioCopilotOutput).sourceLabels, limitations: (output as PortfolioCopilotOutput).limitations, suggestedAction: (output as PortfolioCopilotOutput).suggestedAction, action: { label: "View recovery cases" }, aiJobId: result.jobId };
          emit({ type: "status", phase: "saving", label: "Saving conversation" });
          const metadata = { ...baseMetadata, activity: activity.map((item) => ({ ...item, state: "complete" as const })) };
          const now = new Date().toISOString();
          const title = conversation.title === "New conversation" ? userText.slice(0, 72) : conversation.title;
          await auditStatement(context, { eventType: `AI_${task.toUpperCase()}_GENERATED`, actor: "ai-assistant", detail: { jobId: result.jobId, conversationId: conversation.id, provider: result.provider, consequentialActionTaken: false, sourceGroundedOnServer: true } }).run();
          await db.batch([
            db.insert(assistantMessages).values({ conversationId: conversation.id, role: "user", content: userText, metadataJson: JSON.stringify({ attachmentName: attachmentName || undefined }), createdAt: now }),
            db.insert(assistantMessages).values({ conversationId: conversation.id, role: "assistant", content: text, metadataJson: JSON.stringify(metadata), aiJobId: result.jobId, createdAt: now }),
            db.update(assistantConversations).set({ title, updatedAt: now }).where(eq(assistantConversations.id, conversation.id)),
          ]);
          emit({ type: "answer_start" });
          for (let offset = 0; offset < text.length; offset += 100) {
            emit({ type: "answer_delta", text: text.slice(offset, offset + 100) });
            await new Promise((resolve) => setTimeout(resolve, 12));
          }
          emit({ type: "done", metadata, conversationTitle: title });
        } catch (failure) {
          emit({ type: "error", message: failure instanceof ApiError ? failure.message : "The assistant could not complete this request." });
        } finally {
          try { controller.close(); }
          catch { /* The client closed the stream. */ }
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return apiError(error, "The assistant workflow could not be completed.");
  }
}
