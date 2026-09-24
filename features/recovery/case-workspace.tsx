"use client";

import { type AppMode, type RecoveryCase, type ReviewOutcome } from "./types";
import { useState, useRef } from "react";
import {
  formatNaira,
  formatDays,
  humaniseCopilotText,
  copilotSourceLabel,
} from "./presentation";
import { recoveryCaseStageLabel } from "@/lib/case-stage-policy";
import {
  ArrowLeft,
  Download,
  Paperclip,
  CheckCircle2,
  Mail,
  ShieldCheck,
  CircleAlert,
  Clock3,
  FileSearch2,
  LockKeyhole,
  Check,
  X,
  Quote,
  RefreshCw,
  FileCheck2,
  BadgeCheck,
  ListFilter,
  History,
  Search,
  Bot,
  ArrowUpRight,
  ChevronDown,
} from "lucide-react";
import { StageBadge } from "./badges";
import { ReviewerCorrectionFlow } from "./reviewer-correction";

export function CaseWorkspace({
  mode,
  recoveryCase,
  draftVisible,
  onBack,
  onToggleDraft,
  onCopyDraft,
  onDownload,
  onRecognise,
  onClose,
  onReviewComplete,
  onNotify,
  onAttachReceipt,
}: {
  mode: AppMode;
  recoveryCase: RecoveryCase;
  draftVisible: boolean;
  onBack: () => void;
  onToggleDraft: () => void;
  onCopyDraft: (message?: string, draftId?: string) => void;
  onDownload: () => void;
  onRecognise: () => void | Promise<void>;
  onClose: () => void | Promise<void>;
  onReviewComplete: (
    effectiveValues: Record<string, string>,
    outcome: ReviewOutcome,
  ) => void;
  onNotify: (message: string) => void;
  onAttachReceipt: () => void;
}) {
  const verifiedCount = recoveryCase.evidence.filter(
    (item) => item.state === "verified",
  ).length;
  const allMatched = recoveryCase.checks.every(
    (item) => item.result === "match",
  );
  const receiptEvidence = recoveryCase.evidence.find(
    (item) => item.label === "WHT receipt",
  );
  const authorityEvidence = recoveryCase.evidence.find(
    (item) => item.label === "Authority record",
  );
  const receiptMissing =
    !receiptEvidence ||
    receiptEvidence.state === "missing" ||
    receiptEvidence.state === "pending";
  const authorityMissing =
    !authorityEvidence || authorityEvidence.state !== "verified";
  const mandatoryEvidenceComplete =
    recoveryCase.evidence.length >= 4 &&
    recoveryCase.evidence.every((item) => item.state === "verified");
  const hasExtractedReceipt = Boolean(
    (recoveryCase.sourceDocumentId && !receiptMissing) ||
    receiptEvidence?.state === "verified" ||
    receiptEvidence?.state === "warning",
  );
  const [reviewCompleted, setReviewCompleted] = useState(
    recoveryCase.stage === "recognised" || recoveryCase.stage === "closed",
  );
  const [assistantLoading, setAssistantLoading] = useState<string | null>(null);
  const [recoveryPlan, setRecoveryPlan] = useState<{
    recommendedAction: string;
    evidenceChecklist: Array<{
      item: string;
      status: string;
      responsibleParty: string;
    }>;
    suggestedPriority: string;
    priorityReasons: string[];
    suggestedDueInDays: number;
    escalationInDays: number;
    uncertainty: string;
  } | null>(null);
  const [generatedDraft, setGeneratedDraft] = useState<{
    id?: string;
    subject: string;
    body: string;
    disclaimer: string;
    sourceLabels: string[];
  } | null>(null);
  const [copilotQuestion, setCopilotQuestion] = useState("");
  const copilotInputRef = useRef<HTMLTextAreaElement>(null);
  const [copilotAnswer, setCopilotAnswer] = useState<{
    answer: string;
    sourceLabels: string[];
    limitations: string[];
    suggestedAction: string;
  } | null>(null);
  const copilotExamples = [
    "What evidence is missing?",
    "Why is recognition blocked?",
    "What should I do next?",
  ];
  const chooseCopilotExample = (question: string) => {
    setCopilotQuestion(question);
    requestAnimationFrame(() => copilotInputRef.current?.focus());
  };
  const canRecognise =
    reviewCompleted && allMatched && mandatoryEvidenceComplete;
  const canClose =
    mode === "demo" &&
    recoveryCase.stage === "recognised" &&
    mandatoryEvidenceComplete;
  const outstandingRequirements = [
    receiptMissing ? "WHT receipt" : null,
    authorityMissing ? "connected authority record" : null,
    !allMatched ? "resolved field comparisons" : null,
    !reviewCompleted && hasExtractedReceipt
      ? "completed extraction review"
      : null,
  ].filter(Boolean) as string[];

  const assistantFacts = {
    caseId: recoveryCase.id,
    customer: recoveryCase.customer,
    invoice: recoveryCase.invoice,
    amount: recoveryCase.amount,
    formattedAmount: formatNaira(recoveryCase.amount),
    age: recoveryCase.age,
    stage: recoveryCase.stage,
    exception: recoveryCase.exception,
    narrative: recoveryCase.narrative,
    nextAction: recoveryCase.nextAction,
    recommendedAction: recoveryCase.nextAction,
    missingEvidence: recoveryCase.evidence
      .filter((item) => item.state !== "verified")
      .map((item) => item.label),
    outstanding: outstandingRequirements,
    checks: recoveryCase.checks,
    evidence: recoveryCase.evidence,
    draftType: receiptMissing
      ? "missing_receipt_request"
      : "evidence_correction_request",
  };
  const runAssistant = async (
    action: "recovery-plan" | "communication-draft" | "copilot",
  ) => {
    setAssistantLoading(action);
    try {
      if (mode === "demo") {
        if (action === "recovery-plan") {
          setRecoveryPlan({
            recommendedAction: recoveryCase.nextAction,
            evidenceChecklist: outstandingRequirements.length
              ? outstandingRequirements.map((item) => ({
                  item,
                  status: "missing",
                  responsibleParty: item.includes("authority")
                    ? "authority"
                    : "deducting_customer",
                }))
              : [
                  {
                    item: "Review the matched evidence position",
                    status: "pending",
                    responsibleParty: "internal",
                  },
                ],
            suggestedPriority:
              recoveryCase.age >= 90 || recoveryCase.amount >= 500_000
                ? "high"
                : "standard",
            priorityReasons: [
              `Case age is ${formatDays(recoveryCase.age)}`,
              `Expected WHT is ${formatNaira(recoveryCase.amount)}`,
            ],
            suggestedDueInDays: recoveryCase.age >= 90 ? 5 : 10,
            escalationInDays: recoveryCase.age >= 90 ? 10 : 20,
            uncertainty:
              "Synthetic guidance only. No live record, assignment or status was changed.",
          });
        }
        if (action === "communication-draft") {
          setGeneratedDraft({
            subject: `WHT evidence required for ${recoveryCase.invoice}`,
            body: `Hello ${recoveryCase.customer} team,\n\nOur records show a WHT deduction of ${formatNaira(recoveryCase.amount)} linked to invoice ${recoveryCase.invoice}. ${recoveryCase.nextAction}. Please share the supporting receipt or correction confirmation so we can complete our reconciliation.\n\nRegards,\nWHT Recovery Team`,
            disclaimer:
              "Synthetic draft. Reviewer approval is required before external use.",
            sourceLabels: [
              "Case identity",
              "Financial position",
              "Connected evidence",
            ],
          });
        }
        if (action === "copilot") {
          const missing = outstandingRequirements.length
            ? outstandingRequirements.join(", ")
            : "no mandatory evidence items";
          const asksWhyBlocked = /why|block|recogn/i.test(copilotQuestion);
          const asksMissing = /missing|evidence|outstanding/i.test(
            copilotQuestion,
          );
          setCopilotAnswer({
            answer: asksMissing
              ? `This demo case currently requires ${missing}. The answer comes from the displayed evidence chain and deterministic field comparison.`
              : asksWhyBlocked
                ? canRecognise
                  ? "Recognition is available because the displayed mandatory evidence and deterministic checks have passed."
                  : `Recognition is blocked because the case still requires ${missing}.`
                : `${recoveryCase.customer} has ${formatNaira(recoveryCase.amount)} expected WHT in ${recoveryCaseStageLabel(recoveryCase.stage).toLowerCase()} status. The current required action is: ${recoveryCase.nextAction}.`,
            suggestedAction: recoveryCase.nextAction,
            sourceLabels: [
              "case.identity",
              "case.financialPosition",
              "case.evidence",
              "case.deterministicChecks",
            ],
            limitations: [
              "This is a synthetic demo response",
              "No live records or external authority data were queried",
            ],
          });
        }
        onNotify(
          `${action.replaceAll("-", " ")} generated from synthetic demo records.`,
        );
        return;
      }
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          caseId: recoveryCase.id,
          documentId: recoveryCase.sourceDocumentId,
          question: action === "copilot" ? copilotQuestion.trim() : undefined,
          draftType:
            action === "communication-draft"
              ? assistantFacts.draftType
              : undefined,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        output?: unknown;
        artifact?: { id: string } | null;
      };
      if (!response.ok || !result.output)
        throw new Error(result.error || "Assistant output was unavailable");
      if (action === "recovery-plan")
        setRecoveryPlan(result.output as typeof recoveryPlan);
      if (action === "communication-draft")
        setGeneratedDraft({
          ...(result.output as NonNullable<typeof generatedDraft>),
          id: result.artifact?.id,
        });
      if (action === "copilot")
        setCopilotAnswer(result.output as typeof copilotAnswer);
      onNotify(
        `${action.replaceAll("-", " ")} generated for reviewer consideration.`,
      );
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : "Assistant output was unavailable",
      );
    } finally {
      setAssistantLoading(null);
    }
  };

  return (
    <div className="case-workspace">
      <div className="case-topline">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={17} /> Back to cases
        </button>
        <div className="case-actions">
          <button className="secondary-button" onClick={onDownload}>
            <Download size={17} /> Export pack
          </button>
          {receiptMissing ? (
            <button className="primary-button" onClick={onAttachReceipt}>
              <Paperclip size={17} /> Attach WHT receipt
            </button>
          ) : recoveryCase.stage === "recognised" ? (
            <button
              className={
                mode === "demo" ? "primary-button" : "secondary-button"
              }
              onClick={onClose}
              disabled={!canClose}
              title={
                mode === "live"
                  ? "Record a utilisation outcome and attach supporting evidence through the controlled operations workflow"
                  : !canClose
                    ? "Complete all mandatory evidence controls before utilisation"
                    : undefined
              }
            >
              <CheckCircle2 size={17} />{" "}
              {mode === "live"
                ? "Utilisation evidence required"
                : "Close as utilised"}
            </button>
          ) : (
            <button className="secondary-button" onClick={onToggleDraft}>
              <Mail size={17} /> Draft evidence request
            </button>
          )}
        </div>
      </div>

      <section className="case-hero">
        <div>
          <div className="case-title-row">
            <StageBadge stage={recoveryCase.stage} />
            <span>{recoveryCase.id}</span>
          </div>
          <h1>{recoveryCase.customer}</h1>
          <p>
            {recoveryCase.invoice} · {recoveryCase.exception}
          </p>
        </div>
        <div className="case-amount">
          <span>Expected WHT</span>
          <strong>{formatNaira(recoveryCase.amount)}</strong>
          <small>
            {recoveryCase.confidence > 0
              ? `${recoveryCase.confidence}% evidence confidence`
              : "Confidence not assessed"}
          </small>
        </div>
      </section>

      <section className="case-facts">
        <div>
          <span>Case age</span>
          <strong>
            {recoveryCase.stage === "closed"
              ? "Closed"
              : formatDays(recoveryCase.age)}
          </strong>
        </div>
        <div>
          <span>Owner</span>
          <strong>{recoveryCase.owner}</strong>
        </div>
        <div>
          <span>Last movement</span>
          <strong>{recoveryCase.updated}</strong>
        </div>
        <div>
          <span>Evidence coverage</span>
          <strong>{verifiedCount} of 4 verified</strong>
        </div>
      </section>

      <div className="case-layout">
        <div className="case-main-column">
          <section className="work-panel evidence-panel">
            <div className="section-heading">
              <div>
                <h2>Evidence position</h2>
                <p>Required records in the recovery control chain.</p>
              </div>
              <span className="confidence-label">
                <ShieldCheck size={16} />{" "}
                {recoveryCase.confidence > 0
                  ? `${recoveryCase.confidence}% confidence`
                  : "Not assessed"}
              </span>
            </div>
            <p className="case-narrative">{recoveryCase.narrative}</p>
            <div className="evidence-chain">
              {recoveryCase.evidence.map((item, index) => (
                <div
                  className={`evidence-item evidence-${item.state}`}
                  key={item.label}
                >
                  <span className="evidence-step">{index + 1}</span>
                  <div>
                    <span>{item.label}</span>
                    <strong>{item.reference}</strong>
                    <small>{item.detail}</small>
                  </div>
                  {item.state === "verified" ? (
                    <CheckCircle2 size={18} />
                  ) : item.state === "warning" ? (
                    <CircleAlert size={18} />
                  ) : (
                    <Clock3 size={18} />
                  )}
                </div>
              ))}
            </div>
          </section>

          {hasExtractedReceipt ? (
            <ReviewerCorrectionFlow
              recoveryCase={recoveryCase}
              onReviewStateChange={setReviewCompleted}
              onReviewComplete={onReviewComplete}
              onNotify={onNotify}
            />
          ) : (
            <section className="work-panel correction-empty">
              <span className="document-icon">
                <FileSearch2 size={18} />
              </span>
              <div>
                <h2>No extracted receipt to review</h2>
                <p>
                  Attach receipt evidence and complete field extraction before
                  correction or recognition is available.
                </p>
              </div>
              <button className="secondary-button" onClick={onAttachReceipt}>
                <Paperclip size={17} /> Attach receipt
              </button>
              <span className="review-state pending">
                <LockKeyhole size={15} /> Recognition locked
              </span>
            </section>
          )}

          <section className="work-panel match-panel">
            <div className="section-heading">
              <div>
                <h2>Field comparison</h2>
                <p>
                  Books and evidence compared under the current deterministic
                  rule set.
                </p>
              </div>
              <span className="rule-version">Rules 2026.07</span>
            </div>
            <div className="match-table-wrap">
              <table className="match-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Books</th>
                    <th>Evidence</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {recoveryCase.checks.map((check) => (
                    <tr key={check.label}>
                      <td>
                        <strong>{check.label}</strong>
                      </td>
                      <td>{check.bookValue}</td>
                      <td>{check.evidenceValue}</td>
                      <td>
                        <span className={`match-result ${check.result}`}>
                          {check.result === "match" ? (
                            <Check size={15} />
                          ) : (
                            <CircleAlert size={15} />
                          )}
                          {check.result === "match"
                            ? "Match"
                            : check.result === "missing"
                              ? "Missing"
                              : "Mismatch"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {draftVisible && (
            <section className="draft-panel" aria-live="polite">
              <div className="section-heading">
                <div>
                  <h2>Customer evidence request</h2>
                  <p>
                    Grounded draft only. Reviewer approval is required before
                    this text is copied or used.
                  </p>
                </div>
                <button
                  className="icon-button"
                  onClick={onToggleDraft}
                  aria-label="Close draft"
                >
                  <X size={18} />
                </button>
              </div>
              {generatedDraft ? (
                <>
                  <div className="draft-meta">
                    <span>To: Accounts payable, {recoveryCase.customer}</span>
                    <span>Case: {recoveryCase.id}</span>
                  </div>
                  <div className="draft-copy">
                    <strong>Subject: {generatedDraft.subject}</strong>
                    {generatedDraft.body
                      .split("\n")
                      .map((line, index) =>
                        line ? <p key={index}>{line}</p> : null,
                      )}
                    <small>
                      Sources: {generatedDraft.sourceLabels.join(" · ")}
                    </small>
                  </div>
                  <div className="draft-actions">
                    <span>
                      <ShieldCheck size={16} /> {generatedDraft.disclaimer}
                    </span>
                    <button
                      className="primary-button"
                      onClick={() =>
                        onCopyDraft(
                          `Subject: ${generatedDraft.subject}\n\n${generatedDraft.body}`,
                          generatedDraft.id,
                        )
                      }
                    >
                      <Check size={17} /> Approve and copy
                    </button>
                  </div>
                </>
              ) : (
                <div className="assistant-empty">
                  <Quote size={20} />
                  <div>
                    <strong>Generate a case-grounded draft</strong>
                    <p>
                      The assistant may use only the displayed customer,
                      reference, amount, exception and next action. It cannot
                      send the message.
                    </p>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => void runAssistant("communication-draft")}
                    disabled={assistantLoading !== null}
                  >
                    {assistantLoading === "communication-draft" ? (
                      <RefreshCw className="spin" size={17} />
                    ) : (
                      <Mail size={17} />
                    )}
                    Generate draft
                  </button>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="case-side-column">
          <section className="next-action-panel">
            <span className="action-icon">
              <FileCheck2 size={19} />
            </span>
            <span className="panel-label">Next required action</span>
            <h2>{recoveryCase.nextAction}</h2>
            <p>
              This action follows from the incomplete evidence and control
              checks shown above.
            </p>
            {receiptMissing ? (
              <button
                className="primary-button full-button"
                onClick={onAttachReceipt}
              >
                <Paperclip size={17} /> Attach WHT receipt
              </button>
            ) : recoveryCase.stage !== "recognised" &&
              recoveryCase.stage !== "closed" ? (
              <button
                className="secondary-button full-button"
                onClick={onToggleDraft}
              >
                <Mail size={17} /> Prepare request
              </button>
            ) : null}
            {recoveryCase.stage !== "recognised" &&
              recoveryCase.stage !== "closed" && (
                <button
                  className="quiet-button full-button"
                  onClick={() => void onRecognise()}
                  disabled={!canRecognise}
                  title={
                    !canRecognise
                      ? `Complete: ${outstandingRequirements.join(", ")}`
                      : undefined
                  }
                >
                  {canRecognise ? (
                    <BadgeCheck size={17} />
                  ) : (
                    <LockKeyhole size={17} />
                  )}
                  {canRecognise
                    ? "Recognise reviewed credit"
                    : "Recognition locked"}
                </button>
              )}
            {recoveryCase.stage !== "recognised" &&
              recoveryCase.stage !== "closed" && (
                <p className="recognition-gate">
                  <ShieldCheck size={15} />
                  {canRecognise
                    ? "All mandatory evidence controls have passed."
                    : outstandingRequirements.length
                      ? `Required: ${outstandingRequirements.join(", ")}.`
                      : "Complete all mandatory evidence controls before recognition."}
                </p>
              )}
            {recoveryCase.stage !== "recognised" &&
              recoveryCase.stage !== "closed" && (
                <button
                  className="quiet-button full-button"
                  onClick={() => void runAssistant("recovery-plan")}
                  disabled={assistantLoading !== null}
                >
                  {assistantLoading === "recovery-plan" ? (
                    <RefreshCw className="spin" size={17} />
                  ) : (
                    <ListFilter size={17} />
                  )}
                  Suggest recovery plan
                </button>
              )}
          </section>

          {recoveryPlan && (
            <section className="case-assistant-panel">
              <div className="section-heading">
                <div>
                  <h2>Suggested recovery plan</h2>
                  <p>Reviewable guidance; no status or owner has changed.</p>
                </div>
                <span className="batch-status processing">
                  {recoveryPlan.suggestedPriority}
                </span>
              </div>
              <strong>{recoveryPlan.recommendedAction}</strong>
              <div className="plan-checklist">
                {recoveryPlan.evidenceChecklist.map((item) => (
                  <div key={item.item}>
                    <span className={`evidence-dot ${item.status}`} />
                    <p>
                      <strong>{item.item}</strong>
                      <small>
                        {item.responsibleParty.replaceAll("_", " ")}
                      </small>
                    </p>
                  </div>
                ))}
              </div>
              <p>
                Suggested due date: {recoveryPlan.suggestedDueInDays} days ·
                Escalate after {recoveryPlan.escalationInDays} days.
              </p>
              <small>{recoveryPlan.uncertainty}</small>
            </section>
          )}

          <section className="case-timeline">
            <div className="section-heading">
              <div>
                <h2>Case history</h2>
                <p>Immutable decisions and material case movements.</p>
              </div>
              <History size={18} />
            </div>
            <div className="timeline-list">
              {reviewCompleted && (
                <div>
                  <span />
                  <p>
                    <strong>Extraction review recorded</strong>
                    <small>AO · Immutable audit event</small>
                  </p>
                </div>
              )}
              <div>
                <span />
                <p>
                  <strong>Match run completed</strong>
                  <small>{recoveryCase.updated} · Rules 2026.07</small>
                </p>
              </div>
              <div>
                <span />
                <p>
                  <strong>{recoveryCase.exception}</strong>
                  <small>System exception recorded</small>
                </p>
              </div>
              <div>
                <span />
                <p>
                  <strong>Candidate confirmed</strong>
                  <small>AO · Reviewer decision</small>
                </p>
              </div>
              <div>
                <span />
                <p>
                  <strong>Case created</strong>
                  <small>Imported from July ledger</small>
                </p>
              </div>
            </div>
          </section>

          <section className="case-copilot">
            <div className="section-heading">
              <div>
                <h2>Case copilot</h2>
                <p>Answers only from this case and its connected controls.</p>
              </div>
              <FileSearch2 size={18} />
            </div>
            <label>
              <span className="sr-only">Question about this case</span>
              <textarea
                ref={copilotInputRef}
                value={copilotQuestion}
                onChange={(event) => setCopilotQuestion(event.target.value)}
                placeholder="Ask anything about this case"
              />
            </label>
            <div
              className="copilot-examples"
              aria-label="Example case questions"
            >
              <span>Try asking</span>
              {copilotExamples.map((question) => (
                <button
                  type="button"
                  key={question}
                  onClick={() => chooseCopilotExample(question)}
                >
                  {question}
                </button>
              ))}
            </div>
            <button
              className="secondary-button full-button"
              onClick={() => void runAssistant("copilot")}
              disabled={
                copilotQuestion.trim().length < 5 || assistantLoading !== null
              }
            >
              {assistantLoading === "copilot" ? (
                <RefreshCw className="spin" size={17} />
              ) : (
                <Search size={17} />
              )}
              Ask about this case
            </button>
            {copilotAnswer && (
              <section
                className="copilot-answer"
                aria-label="Case copilot answer"
                aria-live="polite"
              >
                <div className="copilot-answer-heading">
                  <span className="copilot-answer-icon">
                    <Bot size={17} />
                  </span>
                  <div>
                    <strong>Case answer</strong>
                    <small>Grounded in connected case records</small>
                  </div>
                </div>
                <p className="copilot-answer-copy">
                  {humaniseCopilotText(copilotAnswer.answer)}
                </p>
                <div className="copilot-next-step">
                  <ArrowUpRight size={17} />
                  <div>
                    <span>Recommended next step</span>
                    <strong>
                      {humaniseCopilotText(copilotAnswer.suggestedAction)}
                    </strong>
                  </div>
                </div>
                <div className="copilot-sources">
                  <span>Evidence used</span>
                  {copilotAnswer.sourceLabels.length ? (
                    <ul>
                      {copilotAnswer.sourceLabels.map((source) => (
                        <li key={source}>
                          <CheckCircle2 size={14} />
                          {copilotSourceLabel(source)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No connected case source was used.</p>
                  )}
                </div>
                {copilotAnswer.limitations.length > 0 && (
                  <details className="copilot-limitations">
                    <summary>
                      <span>
                        <ShieldCheck size={15} />
                        Scope and limitations
                      </span>
                      <ChevronDown size={15} />
                    </summary>
                    <ul>
                      {copilotAnswer.limitations.map((item) => (
                        <li key={item}>{humaniseCopilotText(item)}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
