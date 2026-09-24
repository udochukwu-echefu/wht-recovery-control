"use client";

import {
  Settings2,
  Building2,
  HardDrive,
  Users,
  ShieldCheck,
  LockKeyhole,
  ChevronRight,
  RefreshCw,
  Check,
  CheckCircle2,
  Bot,
  History,
  Sun,
  CircleAlert,
} from "lucide-react";
import { type AppMode, type SessionInfo } from "./types";
import { useState, useCallback, useEffect } from "react";
import { CustomSelect } from "./custom-select";

type SettingsPayload = {
  workspace: { id: string; name: string; slug: string };
  client: {
    id: string;
    name: string;
    legalName: string;
    tin: string;
    jurisdiction: string;
  };
  settings: {
    maxFileBytes: number;
    maxStorageBytes: number;
    retentionDays: number;
  };
  members: Array<{
    id: string;
    user_id: string;
    email: string;
    display_name: string;
    role: string;
    status: string;
    created_at: string;
  }>;
  usage: { documentCount: number; storageBytes: number };
  ai: { configured: boolean; mode: string; provider: string };
  permissions: {
    canManageWorkspace: boolean;
    canManageMembers: boolean;
    canManageClient: boolean;
  };
  currentUserId: string;
};

type SettingsSection = "general" | "evidence" | "access" | "ai-security";

const settingSections: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  icon: typeof Settings2;
}> = [
  {
    id: "general",
    label: "Workspace and client",
    description: "Identity used across live cases",
    icon: Building2,
  },
  {
    id: "evidence",
    label: "Evidence governance",
    description: "File limits and retention",
    icon: HardDrive,
  },
  {
    id: "access",
    label: "Access and roles",
    description: "Workspace membership",
    icon: Users,
  },
  {
    id: "ai-security",
    label: "AI and security",
    description: "Operational safeguards",
    icon: ShieldCheck,
  },
];

export function SettingsView({
  mode,
  session,
  onNotify,
  onSwitchLive,
  onToggleTheme,
}: {
  mode: AppMode;
  session: SessionInfo | null;
  onNotify: (message: string) => void;
  onSwitchLive: () => void;
  onToggleTheme: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>("general");
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(mode === "live");
  const [saving, setSaving] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [clientName, setClientName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [tin, setTin] = useState("");
  const [jurisdiction, setJurisdiction] = useState("federal");
  const [maxFileBytes, setMaxFileBytes] = useState("1048576");
  const [maxStorageBytes, setMaxStorageBytes] = useState("25000000");
  const [retentionDays, setRetentionDays] = useState("365");

  const applyData = useCallback((payload: SettingsPayload) => {
    setData(payload);
    setWorkspaceName(payload.workspace.name);
    setClientName(payload.client.name);
    setLegalName(payload.client.legalName);
    setTin(payload.client.tin);
    setJurisdiction(payload.client.jurisdiction);
    setMaxFileBytes(String(payload.settings.maxFileBytes));
    setMaxStorageBytes(String(payload.settings.maxStorageBytes));
    setRetentionDays(String(payload.settings.retentionDays));
  }, []);

  const loadSettings = useCallback(async () => {
    if (mode !== "live") return;
    try {
      const response = await fetch("/api/settings");
      const payload = (await response.json()) as SettingsPayload & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error || "Settings are unavailable");
      applyData(payload);
    } catch (error) {
      onNotify(
        error instanceof Error ? error.message : "Settings are unavailable",
      );
    } finally {
      setLoading(false);
    }
  }, [applyData, mode, onNotify]);

  useEffect(() => {
    if (mode !== "live") return;
    let active = true;
    fetch("/api/settings")
      .then(async (response) => {
        const payload = (await response.json()) as SettingsPayload & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(payload.error || "Settings are unavailable");
        if (active) applyData(payload);
      })
      .catch((error) =>
        onNotify(
          error instanceof Error ? error.message : "Settings are unavailable",
        ),
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyData, mode, onNotify]);

  const save = async (name: string, payload: Record<string, unknown>) => {
    setSaving(name);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || "Settings could not be saved");
      await loadSettings();
      onNotify("Settings saved and added to audit history.");
    } catch (error) {
      onNotify(
        error instanceof Error ? error.message : "Settings could not be saved",
      );
    } finally {
      setSaving(null);
    }
  };

  const updateMemberRole = async (membershipId: string, role: string) => {
    await save(`member-${membershipId}`, {
      section: "member-role",
      membershipId,
      role,
    });
  };

  if (mode === "demo")
    return (
      <>
        <section className="page-heading compact-heading">
          <div>
            <h1>Settings</h1>
            <p>
              Workspace configuration applies only to persisted live records.
            </p>
          </div>
        </section>
        <section className="settings-demo-boundary">
          <LockKeyhole size={22} />
          <div>
            <h2>Demo settings are isolated</h2>
            <p>
              The synthetic portfolio does not have editable identity, access or
              retention settings. Switch to Live to manage the authenticated
              workspace.
            </p>
          </div>
          <button className="primary-button" onClick={onSwitchLive}>
            Open live settings
          </button>
        </section>
      </>
    );

  return (
    <>
      <section className="page-heading compact-heading settings-heading">
        <div>
          <h1>Settings</h1>
          <p>
            Manage the live workspace, evidence policy and practitioner access.
          </p>
        </div>
        <span className="settings-scope">
          <LockKeyhole size={15} />
          {session?.workspace.name ?? "Live workspace"}
        </span>
      </section>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {settingSections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={section === item.id ? "active" : ""}
                onClick={() => setSection(item.id)}
                aria-current={section === item.id ? "page" : undefined}
              >
                <Icon size={17} />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <ChevronRight size={15} />
              </button>
            );
          })}
        </nav>
        <section className="settings-surface" aria-live="polite">
          {loading || !data ? (
            <SettingsSkeleton />
          ) : (
            <>
              {section === "general" && (
                <div className="settings-section">
                  <div className="settings-section-title">
                    <h2>Workspace and client</h2>
                    <p>
                      These names and tax identifiers appear on cases, reports
                      and audit packs.
                    </p>
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save("workspace", {
                        section: "workspace",
                        name: workspaceName,
                      });
                    }}
                  >
                    <fieldset
                      disabled={
                        !data.permissions.canManageWorkspace || saving !== null
                      }
                    >
                      <legend>Workspace identity</legend>
                      <label>
                        Workspace name
                        <input
                          value={workspaceName}
                          onChange={(event) =>
                            setWorkspaceName(event.target.value)
                          }
                          minLength={3}
                          maxLength={100}
                          required
                        />
                      </label>
                      <div className="settings-readonly">
                        <span>Workspace ID</span>
                        <code>{data.workspace.id}</code>
                      </div>
                      <div className="settings-form-actions">
                        <span>
                          {data.permissions.canManageWorkspace
                            ? "Changes are recorded in immutable audit history."
                            : "Administrator access is required."}
                        </span>
                        <button
                          className="primary-button"
                          type="submit"
                          disabled={
                            workspaceName.trim() === data.workspace.name ||
                            saving !== null
                          }
                        >
                          {saving === "workspace" ? (
                            <RefreshCw className="spin" size={16} />
                          ) : (
                            <Check size={16} />
                          )}
                          Save workspace
                        </button>
                      </div>
                    </fieldset>
                  </form>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save("client", {
                        section: "client",
                        name: clientName,
                        legalName,
                        tin,
                        jurisdiction,
                      });
                    }}
                  >
                    <fieldset
                      disabled={
                        !data.permissions.canManageClient || saving !== null
                      }
                    >
                      <legend>Default client</legend>
                      <div className="settings-form-grid">
                        <label>
                          Display name
                          <input
                            value={clientName}
                            onChange={(event) =>
                              setClientName(event.target.value)
                            }
                            minLength={2}
                            maxLength={100}
                            required
                          />
                        </label>
                        <label>
                          Legal name
                          <input
                            value={legalName}
                            onChange={(event) =>
                              setLegalName(event.target.value)
                            }
                            minLength={2}
                            maxLength={160}
                            required
                          />
                        </label>
                        <label>
                          Tax identification number
                          <input
                            value={tin}
                            onChange={(event) => setTin(event.target.value)}
                            placeholder="Enter approved entity TIN"
                            maxLength={30}
                          />
                        </label>
                        <label htmlFor="settings-client-jurisdiction">
                          Jurisdiction
                          <CustomSelect
                            id="settings-client-jurisdiction"
                            ariaLabel="Client jurisdiction"
                            value={jurisdiction}
                            onChange={setJurisdiction}
                            options={[
                              { value: "federal", label: "Federal" },
                              { value: "state", label: "State" },
                              { value: "mixed", label: "Mixed" },
                            ]}
                          />
                        </label>
                      </div>
                      <div className="settings-form-actions">
                        <span>
                          Receipt beneficiary checks use this approved entity
                          identity.
                        </span>
                        <button
                          className="primary-button"
                          type="submit"
                          disabled={saving !== null}
                        >
                          {saving === "client" ? (
                            <RefreshCw className="spin" size={16} />
                          ) : (
                            <Check size={16} />
                          )}
                          Save client
                        </button>
                      </div>
                    </fieldset>
                  </form>
                </div>
              )}
              {section === "evidence" && (
                <div className="settings-section">
                  <div className="settings-section-title">
                    <h2>Evidence governance</h2>
                    <p>
                      Set storage limits that match the current D1 document
                      architecture.
                    </p>
                  </div>
                  <div className="storage-position">
                    <div>
                      <span>Stored evidence</span>
                      <strong>
                        {data.usage.documentCount}{" "}
                        {data.usage.documentCount === 1
                          ? "document"
                          : "documents"}
                      </strong>
                    </div>
                    <div>
                      <span>Storage used</span>
                      <strong>
                        {(data.usage.storageBytes / 1_000_000).toFixed(2)} MB of{" "}
                        {(data.settings.maxStorageBytes / 1_000_000).toFixed(0)}{" "}
                        MB
                      </strong>
                    </div>
                    <div
                      className="storage-track"
                      role="progressbar"
                      aria-label="Workspace evidence storage used"
                      aria-valuemin={0}
                      aria-valuemax={data.settings.maxStorageBytes}
                      aria-valuenow={data.usage.storageBytes}
                    >
                      <span
                        style={{
                          width: `${Math.min(100, (data.usage.storageBytes / data.settings.maxStorageBytes) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save("governance", {
                        section: "governance",
                        maxFileBytes: Number(maxFileBytes),
                        maxStorageBytes: Number(maxStorageBytes),
                        retentionDays: Number(retentionDays),
                      });
                    }}
                  >
                    <fieldset
                      disabled={
                        !data.permissions.canManageWorkspace || saving !== null
                      }
                    >
                      <legend>Document policy</legend>
                      <div className="settings-form-grid">
                        <label htmlFor="settings-maximum-file-size">
                          Maximum file size
                          <CustomSelect
                            id="settings-maximum-file-size"
                            ariaLabel="Maximum file size"
                            value={maxFileBytes}
                            onChange={setMaxFileBytes}
                            options={[
                              { value: "250000", label: "250 KB" },
                              { value: "500000", label: "500 KB" },
                              { value: "1048576", label: "1 MB" },
                            ]}
                          />
                          <small>
                            D1 row constraints limit individual originals to 1
                            MB.
                          </small>
                        </label>
                        <label htmlFor="settings-workspace-storage-limit">
                          Workspace storage limit
                          <CustomSelect
                            id="settings-workspace-storage-limit"
                            ariaLabel="Workspace storage limit"
                            value={maxStorageBytes}
                            onChange={setMaxStorageBytes}
                            options={[
                              { value: "10000000", label: "10 MB" },
                              { value: "25000000", label: "25 MB" },
                              { value: "50000000", label: "50 MB" },
                              { value: "100000000", label: "100 MB" },
                            ]}
                          />
                        </label>
                        <label htmlFor="settings-evidence-retention-period">
                          Retention period
                          <CustomSelect
                            id="settings-evidence-retention-period"
                            ariaLabel="Evidence retention period"
                            value={retentionDays}
                            onChange={setRetentionDays}
                            options={[
                              { value: "90", label: "90 days" },
                              { value: "365", label: "1 year" },
                              { value: "1095", label: "3 years" },
                              { value: "2555", label: "7 years" },
                            ]}
                          />
                          <small>
                            Deletion remains an administrator-controlled,
                            audited action.
                          </small>
                        </label>
                      </div>
                      <div className="settings-form-actions">
                        <span>
                          New uploads use this policy. Existing retention dates
                          are not rewritten.
                        </span>
                        <button
                          className="primary-button"
                          type="submit"
                          disabled={saving !== null}
                        >
                          {saving === "governance" ? (
                            <RefreshCw className="spin" size={16} />
                          ) : (
                            <Check size={16} />
                          )}
                          Save policy
                        </button>
                      </div>
                    </fieldset>
                  </form>
                </div>
              )}
              {section === "access" && (
                <div className="settings-section">
                  <div className="settings-section-title">
                    <h2>Access and roles</h2>
                    <p>
                      Roles control settings, review decisions, reporting and
                      case operations.
                    </p>
                  </div>
                  <div
                    className="settings-member-table"
                    role="table"
                    aria-label="Workspace members"
                  >
                    <div role="row" className="settings-member-head">
                      <span role="columnheader">Member</span>
                      <span role="columnheader">Status</span>
                      <span role="columnheader">Role</span>
                    </div>
                    {data.members.map((member) => (
                      <div role="row" key={member.id}>
                        <span role="cell" className="settings-member-identity">
                          <span className="avatar">
                            {member.display_name
                              .split(/\s+/)
                              .map((part) => part[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()}
                          </span>
                          <span>
                            <strong>
                              {member.display_name}
                              {member.user_id === data.currentUserId
                                ? " (you)"
                                : ""}
                            </strong>
                            <small>{member.email}</small>
                          </span>
                        </span>
                        <span role="cell">
                          <span className="member-status">
                            <CheckCircle2 size={14} />
                            {member.status}
                          </span>
                        </span>
                        <span role="cell">
                          {data.permissions.canManageMembers ? (
                            <CustomSelect
                              ariaLabel={`Role for ${member.display_name}`}
                              value={member.role}
                              onChange={(role) =>
                                void updateMemberRole(member.id, role)
                              }
                              disabled={
                                member.user_id === data.currentUserId ||
                                saving !== null
                              }
                              options={[
                                { value: "admin", label: "Administrator" },
                                {
                                  value: "practitioner",
                                  label: "Practitioner",
                                },
                                { value: "reviewer", label: "Reviewer" },
                                { value: "analyst", label: "Analyst" },
                                { value: "read_only", label: "Read only" },
                              ]}
                            />
                          ) : (
                            <span>{member.role.replaceAll("_", " ")}</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="settings-inline-note">
                    <ShieldCheck size={17} />
                    <p>
                      Invitations are not enabled in this MVP. Identity is
                      provisioned by the trusted authentication proxy, then
                      assigned to an existing workspace by an administrator.
                    </p>
                  </div>
                </div>
              )}
              {section === "ai-security" && (
                <div className="settings-section">
                  <div className="settings-section-title">
                    <h2>AI and security</h2>
                    <p>
                      Review service availability and controls without exposing
                      provider secrets.
                    </p>
                  </div>
                  <div className="settings-status-list">
                    <div>
                      <span
                        className={`settings-status-icon ${data.ai.configured ? "success" : "warning"}`}
                      >
                        <Bot size={18} />
                      </span>
                      <span>
                        <strong>AI-assisted receipt extraction</strong>
                        <small>
                          {data.ai.configured
                            ? `${data.ai.provider} is available. Outputs remain advisory and reviewable.`
                            : "Receipt extraction is unavailable. Manual entry remains available."}
                        </small>
                      </span>
                      <span
                        className={`stage-badge ${data.ai.configured ? "stage-recognised" : "stage-evidence-needed"}`}
                      >
                        {data.ai.configured ? "Available" : "Action required"}
                      </span>
                    </div>
                    <div>
                      <span className="settings-status-icon success">
                        <LockKeyhole size={18} />
                      </span>
                      <span>
                        <strong>Server-grounded assistant</strong>
                        <small>
                          Case facts are rebuilt from workspace-scoped D1
                          records. Browser facts are ignored.
                        </small>
                      </span>
                      <span className="stage-badge stage-recognised">
                        Enforced
                      </span>
                    </div>
                    <div>
                      <span className="settings-status-icon success">
                        <History size={18} />
                      </span>
                      <span>
                        <strong>Immutable audit history</strong>
                        <small>
                          Update and delete triggers protect audit events.
                          Settings changes record before and after values.
                        </small>
                      </span>
                      <span className="stage-badge stage-recognised">
                        Enforced
                      </span>
                    </div>
                    <div>
                      <span className="settings-status-icon success">
                        <ShieldCheck size={18} />
                      </span>
                      <span>
                        <strong>Human decision gates</strong>
                        <small>
                          Recognition and utilisation remain blocked until
                          mandatory evidence controls pass.
                        </small>
                      </span>
                      <span className="stage-badge stage-recognised">
                        Enforced
                      </span>
                    </div>
                  </div>
                  <div className="appearance-setting">
                    <span>
                      <Sun size={18} />
                      <span>
                        <strong>Appearance</strong>
                        <small>
                          Switch between the dark operations theme and
                          high-contrast light theme.
                        </small>
                      </span>
                    </span>
                    <button
                      className="secondary-button"
                      onClick={onToggleTheme}
                    >
                      <Sun size={16} />
                      Toggle theme
                    </button>
                  </div>
                  <div className="settings-inline-note">
                    <CircleAlert size={17} />
                    <p>
                      Secrets are managed outside the product interface. Contact
                      the deployment administrator to rotate or restore provider
                      credentials.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}

function SettingsSkeleton() {
  return (
    <div className="settings-skeleton" aria-label="Loading workspace settings">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
