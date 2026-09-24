import { and, eq } from "drizzle-orm";
import { getAiConfig, getD1, getDb } from "@/db";
import { clients, workspaceSettings, workspaces } from "@/db/schema";
import { apiError, auditStatement, requireContext, workspaceRoles, type WorkspaceRole } from "@/lib/auth";

export const runtime = "edge";

type MemberRow = {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: WorkspaceRole;
  status: string;
  created_at: string;
};

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    const db = getDb();
    const d1 = getD1();
    const [workspace, client, settings, members, usage] = await Promise.all([
      db.select().from(workspaces).where(eq(workspaces.id, context.workspace.id)).limit(1),
      db.select().from(clients).where(and(eq(clients.id, context.clientId), eq(clients.workspaceId, context.workspace.id))).limit(1),
      db.select().from(workspaceSettings).where(eq(workspaceSettings.workspaceId, context.workspace.id)).limit(1),
      d1.prepare(`SELECT m.id, m.user_id, u.email, u.display_name, m.role, m.status, m.created_at
        FROM workspace_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'admin' THEN 0 WHEN 'practitioner' THEN 1 WHEN 'reviewer' THEN 2 WHEN 'analyst' THEN 3 ELSE 4 END, u.display_name`)
        .bind(context.workspace.id).all<MemberRow>(),
      d1.prepare(`SELECT COUNT(*) AS document_count, COALESCE(SUM(size_bytes),0) AS storage_bytes
        FROM evidence_documents WHERE workspace_id = ? AND deleted_at IS NULL`).bind(context.workspace.id).first<{ document_count: number; storage_bytes: number }>(),
    ]);
    const ai = getAiConfig();
    return Response.json({
      workspace: workspace[0],
      client: client[0],
      settings: settings[0],
      members: members.results,
      usage: { documentCount: usage?.document_count ?? 0, storageBytes: usage?.storage_bytes ?? 0 },
      ai: { configured: Boolean(ai.apiKey) || ai.mode === "demo", mode: ai.mode === "deepseek" ? "managed" : ai.mode, provider: ai.apiKey ? "Managed AI" : "Manual fallback" },
      permissions: { canManageWorkspace: context.workspace.role === "admin", canManageMembers: context.workspace.role === "admin", canManageClient: ["admin", "practitioner"].includes(context.workspace.role) },
      currentUserId: context.user.id,
    });
  } catch (error) {
    return apiError(error, "Workspace settings could not be loaded.");
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireContext(request, ["admin", "practitioner"]);
    const body = await request.json() as Record<string, unknown>;
    const section = String(body.section ?? "");
    const d1 = getD1();
    const now = new Date().toISOString();

    if (section === "workspace") {
      if (context.workspace.role !== "admin") return Response.json({ error: "Only workspace administrators can change workspace identity." }, { status: 403 });
      const name = String(body.name ?? "").trim();
      if (name.length < 3 || name.length > 100) return Response.json({ error: "Workspace name must contain 3 to 100 characters." }, { status: 400 });
      await d1.batch([
        auditStatement(context, { eventType: "WORKSPACE_SETTINGS_CHANGED", detail: { section, before: { name: context.workspace.name }, after: { name } } }),
        d1.prepare("UPDATE workspaces SET name = ? WHERE id = ?").bind(name, context.workspace.id),
      ]);
      return Response.json({ section, name, updatedAt: now });
    }

    if (section === "client") {
      const name = String(body.name ?? "").trim();
      const legalName = String(body.legalName ?? "").trim();
      const tin = String(body.tin ?? "").trim();
      const jurisdiction = String(body.jurisdiction ?? "federal").trim();
      if (name.length < 2 || legalName.length < 2) return Response.json({ error: "Client and legal names must contain at least 2 characters." }, { status: 400 });
      if (tin && !/^[A-Za-z0-9-]{6,30}$/.test(tin)) return Response.json({ error: "TIN must contain 6 to 30 letters, numbers or hyphens." }, { status: 400 });
      if (!["federal", "state", "mixed"].includes(jurisdiction)) return Response.json({ error: "Select federal, state or mixed jurisdiction." }, { status: 400 });
      const before = await d1.prepare("SELECT name, legal_name, tin, jurisdiction FROM clients WHERE id = ? AND workspace_id = ?").bind(context.clientId, context.workspace.id).first();
      await d1.batch([
        auditStatement(context, { eventType: "CLIENT_SETTINGS_CHANGED", detail: { section, before, after: { name, legalName, tin, jurisdiction } } }),
        d1.prepare("UPDATE clients SET name = ?, legal_name = ?, tin = ?, jurisdiction = ? WHERE id = ? AND workspace_id = ?").bind(name, legalName, tin, jurisdiction, context.clientId, context.workspace.id),
      ]);
      return Response.json({ section, name, legalName, tin, jurisdiction, updatedAt: now });
    }

    if (section === "governance") {
      if (context.workspace.role !== "admin") return Response.json({ error: "Only workspace administrators can change evidence governance." }, { status: 403 });
      const maxFileBytes = Number(body.maxFileBytes);
      const maxStorageBytes = Number(body.maxStorageBytes);
      const retentionDays = Number(body.retentionDays);
      if (!Number.isInteger(maxFileBytes) || maxFileBytes < 100_000 || maxFileBytes > 1_048_576) return Response.json({ error: "Per-file limit must be between 100 KB and 1 MB for D1 storage." }, { status: 400 });
      if (!Number.isInteger(maxStorageBytes) || maxStorageBytes < 1_000_000 || maxStorageBytes > 100_000_000) return Response.json({ error: "Workspace storage limit must be between 1 MB and 100 MB." }, { status: 400 });
      if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 2_555) return Response.json({ error: "Retention must be between 30 days and 7 years." }, { status: 400 });
      const before = await d1.prepare("SELECT max_file_bytes, max_storage_bytes, retention_days FROM workspace_settings WHERE workspace_id = ?").bind(context.workspace.id).first();
      await d1.batch([
        auditStatement(context, { eventType: "EVIDENCE_GOVERNANCE_CHANGED", detail: { section, before, after: { maxFileBytes, maxStorageBytes, retentionDays } } }),
        d1.prepare("UPDATE workspace_settings SET max_file_bytes = ?, max_storage_bytes = ?, retention_days = ?, updated_at = ? WHERE workspace_id = ?").bind(maxFileBytes, maxStorageBytes, retentionDays, now, context.workspace.id),
      ]);
      return Response.json({ section, maxFileBytes, maxStorageBytes, retentionDays, updatedAt: now });
    }

    if (section === "member-role") {
      if (context.workspace.role !== "admin") return Response.json({ error: "Only workspace administrators can change roles." }, { status: 403 });
      const membershipId = String(body.membershipId ?? "").trim();
      const role = String(body.role ?? "") as WorkspaceRole;
      if (!membershipId || !workspaceRoles.includes(role)) return Response.json({ error: "Membership and valid role are required." }, { status: 400 });
      const member = await d1.prepare("SELECT id, user_id, role FROM workspace_memberships WHERE id = ? AND workspace_id = ? AND status = 'active'").bind(membershipId, context.workspace.id).first<{ id: string; user_id: string; role: WorkspaceRole }>();
      if (!member) return Response.json({ error: "Active membership not found." }, { status: 404 });
      if (member.user_id === context.user.id && role !== "admin") return Response.json({ error: "You cannot remove your own administrator access." }, { status: 409 });
      await d1.batch([
        auditStatement(context, { eventType: "MEMBER_ROLE_CHANGED", detail: { membershipId, userId: member.user_id, before: member.role, after: role } }),
        d1.prepare("UPDATE workspace_memberships SET role = ? WHERE id = ? AND workspace_id = ?").bind(role, membershipId, context.workspace.id),
      ]);
      return Response.json({ section, membershipId, role, updatedAt: now });
    }

    return Response.json({ error: "A supported settings section is required." }, { status: 400 });
  } catch (error) {
    return apiError(error, "Workspace settings could not be saved.");
  }
}
