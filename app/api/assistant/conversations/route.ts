import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { assistantConversations, assistantMessages } from "@/db/schema";
import { apiError, enforceRateLimit, requireContext } from "@/lib/auth";

export const runtime = "edge";

const assistantRoles = ["admin", "practitioner", "reviewer", "analyst"] as const;

export async function GET(request: Request) {
  try {
    const context = await requireContext(request, assistantRoles);
    const db = getDb();
    const conversations = await db.select().from(assistantConversations).where(and(
      eq(assistantConversations.workspaceId, context.workspace.id),
      eq(assistantConversations.clientId, context.clientId),
      eq(assistantConversations.userId, context.user.id),
    )).orderBy(desc(assistantConversations.updatedAt)).limit(20);
    const requestedId = new URL(request.url).searchParams.get("id");
    const active = requestedId ? conversations.find((item) => item.id === requestedId) : conversations[0];
    if (requestedId && !active) return Response.json({ error: "Conversation not found." }, { status: 404 });
    const rows = active ? await db.select().from(assistantMessages).where(eq(assistantMessages.conversationId, active.id)).orderBy(desc(assistantMessages.id)).limit(100) : [];
    return Response.json({
      conversations: conversations.map((item) => ({ id: item.id, title: item.title, updatedAt: item.updatedAt })),
      activeId: active?.id ?? null,
      messages: rows.reverse().map((item) => ({ id: String(item.id), role: item.role, content: item.content, metadata: JSON.parse(item.metadataJson), createdAt: item.createdAt })),
    });
  } catch (error) {
    return apiError(error, "Conversations are temporarily unavailable.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireContext(request, assistantRoles);
    await enforceRateLimit(context, "assistant-conversation", 12, 60);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await getDb().insert(assistantConversations).values({ id, workspaceId: context.workspace.id, clientId: context.clientId, userId: context.user.id, createdAt: now, updatedAt: now });
    return Response.json({ id, title: "New conversation", updatedAt: now }, { status: 201 });
  } catch (error) {
    return apiError(error, "A new conversation could not be started.");
  }
}
