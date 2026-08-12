import { getD1 } from "@/db";

export const workspaceRoles = ["admin", "practitioner", "reviewer", "analyst", "read_only"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

export type RequestContext = {
  user: { id: string; providerSubject: string; email: string; displayName: string };
  workspace: { id: string; name: string; role: WorkspaceRole };
  clientId: string;
  localDevelopment: boolean;
};

type MembershipRow = {
  user_id: string;
  provider_subject: string;
  email: string;
  display_name: string;
  workspace_id: string;
  workspace_name: string;
  role: string;
  default_client_id: string | null;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function header(request: Request, name: string) {
  return request.headers.get(name)?.trim() ?? "";
}

async function stableSuffix(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).slice(0, 10), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isWorkspaceRole(value: string): value is WorkspaceRole {
  return workspaceRoles.includes(value as WorkspaceRole);
}

/**
 * Resolve identity only from trusted request headers. Local development gets a
 * visible, isolated account so the application remains usable without the
 * production identity proxy; production requests fail closed.
 */
export async function requireContext(request: Request, allowedRoles: readonly WorkspaceRole[] = workspaceRoles): Promise<RequestContext> {
  const url = new URL(request.url);
  const fetchSite = header(request, "sec-fetch-site");
  const origin = header(request, "origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && (fetchSite === "cross-site" || (origin && origin !== url.origin))) {
    throw new ApiError(403, "Cross-site mutation requests are not allowed.");
  }
  const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "0.0.0.0";
  const providerSubject = header(request, "oai-authenticated-user-id") || (localDevelopment ? "local-development-user" : "");
  const email = header(request, "oai-authenticated-user-email") || (localDevelopment ? "local@wht-recovery.test" : "");
  const displayName = header(request, "oai-authenticated-user-full-name") || (localDevelopment ? "Local practitioner" : "");

  if (!providerSubject) throw new ApiError(401, "Sign in is required to access this workspace.");

  const suffix = await stableSuffix(providerSubject);
  const userId = `usr_${suffix}`;
  const bootstrapWorkspaceId = `ws_${suffix}`;
  const bootstrapClientId = `client_${suffix}`;
  const db = getD1();
  const now = new Date().toISOString();

  await db.batch([
    db.prepare("INSERT INTO users (id, provider_subject, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?) ON CONFLICT(provider_subject) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, updated_at = excluded.updated_at")
      .bind(userId, providerSubject, email || "unknown@example.invalid", displayName || email || "WHT practitioner", now, now),
    db.prepare("INSERT OR IGNORE INTO workspaces (id, name, slug, mode, created_at) VALUES (?, ?, ?, 'live', ?)")
      .bind(bootstrapWorkspaceId, localDevelopment ? "Local WHT workspace" : `${displayName || "My"} workspace`, `workspace-${suffix}`, now),
    db.prepare("INSERT OR IGNORE INTO workspace_memberships (id, workspace_id, user_id, role, status, created_at) VALUES (?, ?, ?, 'admin', 'active', ?)")
      .bind(`member_${suffix}`, bootstrapWorkspaceId, userId, now),
    db.prepare("INSERT OR IGNORE INTO clients (id, workspace_id, name, legal_name, entity_type, jurisdiction, tin, status, created_at) VALUES (?, ?, 'Default client', 'Default client', 'company', 'federal', '', 'active', ?)")
      .bind(bootstrapClientId, bootstrapWorkspaceId, now),
    db.prepare("INSERT OR IGNORE INTO workspace_settings (workspace_id, max_file_bytes, max_storage_bytes, retention_days, default_client_id, updated_at) VALUES (?, 1048576, 25000000, 365, ?, ?)")
      .bind(bootstrapWorkspaceId, bootstrapClientId, now),
  ]);

  const requestedWorkspace = header(request, "x-wht-workspace");
  const membership = await db.prepare(`
    SELECT u.id AS user_id, u.provider_subject, u.email, u.display_name,
           w.id AS workspace_id, w.name AS workspace_name, m.role,
           s.default_client_id
    FROM users u
    JOIN workspace_memberships m ON m.user_id = u.id AND m.status = 'active'
    JOIN workspaces w ON w.id = m.workspace_id
    LEFT JOIN workspace_settings s ON s.workspace_id = w.id
    WHERE u.provider_subject = ? AND u.status = 'active'
      AND (? = '' OR w.id = ?)
    ORDER BY m.created_at ASC
    LIMIT 1
  `).bind(providerSubject, requestedWorkspace, requestedWorkspace).first<MembershipRow>();

  if (!membership) throw new ApiError(requestedWorkspace ? 403 : 401, requestedWorkspace ? "You do not have access to that workspace." : "No active workspace membership was found.");
  if (!isWorkspaceRole(membership.role)) throw new ApiError(403, "Your workspace role is not recognised.");
  if (!allowedRoles.includes(membership.role)) throw new ApiError(403, "Your role does not permit this action.");
  if (!membership.default_client_id) throw new ApiError(409, "Select a default client before continuing.");

  return {
    user: { id: membership.user_id, providerSubject: membership.provider_subject, email: membership.email, displayName: membership.display_name },
    workspace: { id: membership.workspace_id, name: membership.workspace_name, role: membership.role },
    clientId: membership.default_client_id,
    localDevelopment,
  };
}

export async function enforceRateLimit(context: RequestContext, scope: string, limit: number, windowSeconds = 60) {
  const d1 = getD1();
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
  const bucketKey = `${context.workspace.id}:${context.user.id}:${scope}`;
  await d1.prepare(`INSERT INTO rate_limit_buckets (bucket_key, window_started_at, request_count) VALUES (?, ?, 1)
    ON CONFLICT(bucket_key) DO UPDATE SET
      request_count = CASE WHEN window_started_at = excluded.window_started_at THEN request_count + 1 ELSE 1 END,
      window_started_at = excluded.window_started_at`)
    .bind(bucketKey, windowStart).run();
  const bucket = await d1.prepare("SELECT request_count FROM rate_limit_buckets WHERE bucket_key = ?").bind(bucketKey).first<{ request_count: number }>();
  if ((bucket?.request_count ?? 0) > limit) throw new ApiError(429, "Too many requests. Wait briefly and try again.");
}

export function apiError(error: unknown, fallback: string) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error(JSON.stringify({ message: fallback, error: error instanceof Error ? error.message : "Unexpected error" }));
  return Response.json({ error: fallback }, { status: 500 });
}

export function auditStatement(
  context: RequestContext,
  input: { eventType: string; caseId?: string | null; documentId?: string | null; detail?: Record<string, unknown>; actor?: "user" | "system" | "ai-assistant" },
) {
  return getD1().prepare(`
    INSERT INTO audit_events
      (id, workspace_id, case_id, document_id, event_type, actor, actor_user_id, actor_display_name, actor_role, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), context.workspace.id, input.caseId ?? null, input.documentId ?? null,
    input.eventType, input.actor ?? "user", context.user.id, context.user.displayName,
    context.workspace.role, JSON.stringify(input.detail ?? {}), new Date().toISOString(),
  );
}
