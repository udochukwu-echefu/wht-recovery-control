"use client";

import { type AppMode } from "./types";
import { useState, useCallback, useEffect } from "react";
import { ShieldCheck, CircleAlert } from "lucide-react";

export function RulesView({
  mode,
  onNotify,
}: {
  mode: AppMode;
  onNotify: (message: string) => void;
}) {
  const controlDefinitions = [
    {
      name: "AI-assisted receipt extraction",
      logic: "Receipt text is converted into source-grounded fields",
      control: "Extraction cannot recognise or close a case",
      status: "Assistive",
    },
    {
      name: "Payment-gap candidate",
      logic: "Invoice gross less matched payment exceeds configured tolerance",
      control: "Reviewer confirms applicability",
      status: "Active",
    },
    {
      name: "Beneficiary identity",
      logic: "Receipt TIN must equal the approved entity master TIN",
      control: "Exact match required",
      status: "Active",
    },
    {
      name: "Receipt amount",
      logic: "Expected, receipt and authority amounts are compared separately",
      control: "Partial states preserved",
      status: "Active",
    },
    {
      name: "External communication",
      logic: "Drafts use case facts and evidence references only",
      control: "Human approval required",
      status: "Enforced",
    },
  ];
  const [ruleSets, setRuleSets] = useState<
    Array<{
      id: string;
      version: string;
      status: string;
      effective_start: string;
      practitioner_notes: string;
      approved_at: string | null;
    }>
  >([]);
  const [loading, setLoading] = useState(mode === "live");
  const [version, setVersion] = useState("2026.08");
  const [effectiveStart, setEffectiveStart] = useState("2026-08-01");
  const [note, setNote] = useState("");
  const [approvalNote, setApprovalNote] = useState("");

  const load = useCallback(async () => {
    if (mode === "demo") return;
    try {
      const response = await fetch("/api/rules");
      const result = (await response.json()) as {
        rules?: typeof ruleSets;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "Rule sets are unavailable");
      setRuleSets(result.rules ?? []);
    } catch (error) {
      onNotify(
        error instanceof Error ? error.message : "Rule sets are unavailable",
      );
    } finally {
      setLoading(false);
    }
  }, [mode, onNotify]);

  useEffect(() => {
    if (mode === "demo") return;
    let active = true;
    fetch("/api/rules")
      .then(async (response) => {
        const result = (await response.json()) as {
          rules?: typeof ruleSets;
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || "Rule sets are unavailable");
        if (active) setRuleSets(result.rules ?? []);
      })
      .catch((error) =>
        onNotify(
          error instanceof Error ? error.message : "Rule sets are unavailable",
        ),
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, onNotify]);

  const createRuleSet = async () => {
    if (mode === "demo") {
      onNotify("Switch to Live workspace to create governed rule sets.");
      return;
    }
    try {
      const response = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          version,
          effectiveStart,
          amountToleranceKobo: 10_000,
          applicabilityCategories: [
            "services",
            "contracts",
            "rent",
            "commission",
          ],
          note,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || "Rule set could not be created");
      setNote("");
      await load();
      onNotify(
        "Draft rule set created. A practitioner must approve it before use.",
      );
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : "Rule set could not be created",
      );
    }
  };

  const approve = async (ruleSetId: string) => {
    if (approvalNote.trim().length < 10) {
      onNotify(
        "Approval was not recorded; a rationale of at least 10 characters is required.",
      );
      return;
    }
    try {
      const response = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "approve",
          ruleSetId,
          note: approvalNote,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error || "Rule set could not be approved");
      setApprovalNote("");
      await load();
      onNotify("Rule set approved with immutable change history.");
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : "Rule set could not be approved",
      );
    }
  };
  const active = ruleSets.find((rule) => rule.status === "approved");

  return (
    <>
      <section className="page-heading compact-heading">
        <div>
          <h1>Rules & controls</h1>
          <p>
            Deterministic controls compare source facts. Practitioner decisions
            remain visible and accountable.
          </p>
        </div>
      </section>

      <section className="rule-summary">
        <div>
          <span className="rule-icon">
            <ShieldCheck size={21} />
          </span>
          <div>
            <strong>
              {mode === "demo"
                ? "Demo rule illustrations"
                : active
                  ? `Rule set ${active.version}`
                  : "No approved rule set"}
            </strong>
            <span>
              {mode === "demo"
                ? "Synthetic walkthrough only"
                : active
                  ? `Effective ${active.effective_start} · Approval recorded ${active.approved_at ? new Date(active.approved_at).toLocaleDateString("en-NG") : "in audit history"}`
                  : "Live imports are blocked until a practitioner approves a rule set"}
            </span>
          </div>
        </div>
        <span
          className={`stage-badge ${active ? "stage-recognised" : "stage-evidence-needed"}`}
        >
          {mode === "demo" ? "Demo" : active ? "Current" : "Action required"}
        </span>
      </section>

      {mode === "live" && (
        <section className="work-panel rule-editor">
          <div className="panel-heading">
            <div>
              <h2>Versioned rule sets</h2>
              <p>
                Create a draft, then record a separate practitioner approval
                before it becomes effective.
              </p>
            </div>
          </div>
          {loading ? (
            <p>Loading rule sets…</p>
          ) : (
            <>
              <div className="rule-form">
                <label>
                  Version
                  <input
                    value={version}
                    onChange={(event) => setVersion(event.target.value)}
                    placeholder="2026.08"
                  />
                </label>
                <label>
                  Effective date
                  <input
                    type="date"
                    value={effectiveStart}
                    onChange={(event) => setEffectiveStart(event.target.value)}
                  />
                </label>
                <label className="rule-note">
                  Change rationale
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Explain why this rule set is needed"
                  />
                </label>
                <button
                  className="primary-button"
                  onClick={() => void createRuleSet()}
                  disabled={note.trim().length < 10}
                >
                  Create draft
                </button>
              </div>
              {ruleSets.some((rule) => rule.status === "draft") && (
                <label className="rule-approval-note">
                  Approval rationale
                  <input
                    value={approvalNote}
                    onChange={(event) => setApprovalNote(event.target.value)}
                    placeholder="Record the basis for practitioner approval"
                  />
                </label>
              )}
              <div className="rule-set-history">
                {ruleSets.map((rule) => (
                  <div key={rule.id}>
                    <span>
                      <strong>{rule.version}</strong>
                      <small>
                        Effective {rule.effective_start} · {rule.status}
                      </small>
                    </span>
                    {rule.status === "draft" && (
                      <button
                        className="secondary-button"
                        onClick={() => void approve(rule.id)}
                        disabled={approvalNote.trim().length < 10}
                      >
                        Review and approve
                      </button>
                    )}
                  </div>
                ))}
                {!ruleSets.length && (
                  <p>
                    No governed rule sets have been created in this workspace.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <section className="work-panel rule-panel">
        <div className="rule-list">
          {controlDefinitions.map((rule, index) => (
            <div className="rule-row" key={rule.name}>
              <span className="rule-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>{rule.name}</strong>
                <span>{rule.logic}</span>
              </div>
              <div>
                <strong>Control</strong>
                <span>{rule.control}</span>
              </div>
              <span className="rule-status">{rule.status}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="control-note">
        <CircleAlert size={19} />
        <p>
          <strong>
            Rates and administrative procedures are configuration, not
            application code.
          </strong>{" "}
          Every match run records the rule version used so later changes do not
          rewrite history.
        </p>
      </div>
    </>
  );
}
