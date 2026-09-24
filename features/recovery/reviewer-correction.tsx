"use client";

import {
  type RecoveryCase,
  type ReviewData,
  type ReviewOutcome,
} from "./types";
import { formatNaira } from "./presentation";
import { useState, useEffect } from "react";
import { matchOutcomeForException } from "@/lib/case-stage-policy";
import {
  CheckCircle2,
  LockKeyhole,
  ChevronRight,
  FileText,
  Quote,
  PencilLine,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";

const reviewFieldLabels: Record<string, string> = {
  customer_name: "Customer name",
  beneficiary_tin: "Beneficiary TIN",
  invoice_reference: "Invoice reference",
  receipt_number: "Receipt number",
  wht_amount: "WHT amount (NGN)",
  reporting_period: "Reporting period",
};

function demoReviewData(recoveryCase: RecoveryCase): ReviewData {
  const evidenceReceipt = recoveryCase.evidence.find(
    (item) => item.label === "WHT receipt",
  );
  const byLabel = Object.fromEntries(
    recoveryCase.checks.map((check) => [check.label, check.evidenceValue]),
  );
  const values: Record<string, string> = {
    customer_name: byLabel.Customer || recoveryCase.customer,
    beneficiary_tin:
      byLabel["Beneficiary TIN"] === "Not extracted"
        ? ""
        : byLabel["Beneficiary TIN"] || "",
    invoice_reference:
      byLabel["Invoice reference"] === "Not provided"
        ? ""
        : recoveryCase.invoice,
    receipt_number:
      evidenceReceipt?.reference &&
      !["Missing", "Not assessed"].includes(evidenceReceipt.reference)
        ? evidenceReceipt.reference
        : "",
    wht_amount: (
      byLabel["WHT amount"] || formatNaira(recoveryCase.amount)
    ).replace(/[^0-9.]/g, ""),
    reporting_period:
      byLabel["Reporting period"] === "Unknown"
        ? ""
        : byLabel["Reporting period"] || "",
  };
  const quoteByField: Record<string, string> = {
    customer_name: `Deducting customer: ${values.customer_name}`,
    beneficiary_tin: values.beneficiary_tin
      ? `Beneficiary TIN ${values.beneficiary_tin}`
      : "No beneficiary TIN located",
    invoice_reference: values.invoice_reference
      ? `Invoice ${values.invoice_reference}`
      : "No invoice reference located",
    receipt_number: values.receipt_number
      ? `Receipt No. ${values.receipt_number}`
      : "No receipt number located",
    wht_amount: values.wht_amount
      ? `WHT amount NGN ${values.wht_amount}`
      : "No WHT amount located",
    reporting_period: values.reporting_period
      ? `Period ${values.reporting_period}`
      : "No reporting period located",
  };
  return {
    caseId: recoveryCase.id,
    ruleVersion: "2026.07",
    document: {
      id: "demo-receipt",
      fileName: `${recoveryCase.invoice}-wht-receipt.pdf`,
      sha256:
        "4eab7f69a37241bbbc9f4c909d8feef4769cc89bd5f560673a118f1349072b91",
      aiModel: "deepseek-v4-flash",
      aiResponseId: "resp_demo_0731",
      createdAt: new Date().toISOString(),
    },
    fields: Object.entries(values).map(([fieldName, value], index) => ({
      id: `demo-${fieldName}`,
      fieldName,
      originalValue: value,
      reviewedValue: null,
      effectiveValue: value,
      confidence: Math.max(58, recoveryCase.confidence - index * 3),
      evidenceQuote: quoteByField[fieldName],
      pageNumber: 1,
      editable: true,
    })),
    review: {
      completed:
        recoveryCase.stage === "recognised" || recoveryCase.stage === "closed",
    },
  };
}

export function ReviewerCorrectionFlow({
  recoveryCase,
  onReviewStateChange,
  onReviewComplete,
  onNotify,
}: {
  recoveryCase: RecoveryCase;
  onReviewStateChange: (completed: boolean) => void;
  onReviewComplete: (
    effectiveValues: Record<string, string>,
    outcome: ReviewOutcome,
  ) => void;
  onNotify: (message: string) => void;
}) {
  const [data, setData] = useState<ReviewData>(() =>
    demoReviewData(recoveryCase),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      data.fields.map((field) => [field.fieldName, field.effectiveValue]),
    ),
  );
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(
    Boolean(recoveryCase.sourceDocumentId),
  );
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(
    !(recoveryCase.stage === "recognised" || recoveryCase.stage === "closed"),
  );

  useEffect(() => {
    let active = true;
    if (!recoveryCase.sourceDocumentId)
      return () => {
        active = false;
      };
    void fetch(`/api/review?caseId=${encodeURIComponent(recoveryCase.id)}`)
      .then(async (response) => {
        const result = (await response.json()) as ReviewData & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(result.error || "Review data unavailable");
        if (!active) return;
        setData(result);
        setValues(
          Object.fromEntries(
            result.fields.map((field) => [
              field.fieldName,
              field.effectiveValue,
            ]),
          ),
        );
        onReviewStateChange(result.review.completed);
      })
      .catch((error) => {
        if (active)
          onNotify(
            error instanceof Error ? error.message : "Review data unavailable",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    recoveryCase.id,
    recoveryCase.sourceDocumentId,
    onNotify,
    onReviewStateChange,
  ]);

  const changes = data.fields.filter(
    (field) =>
      (values[field.fieldName] ?? "").trim() !== field.effectiveValue.trim(),
  );
  const noteRequired = changes.length > 0;
  const canSubmit = !saving && (!noteRequired || note.trim().length >= 10);

  const localOutcome = (
    effectiveValues: Record<string, string>,
  ): ReviewOutcome => {
    const normalized = (value: string) =>
      value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const check = (label: string) =>
      recoveryCase.checks.find((item) => item.label === label);
    const tin = effectiveValues.beneficiary_tin ?? "";
    const invoiceReference = effectiveValues.invoice_reference ?? "";
    const period = effectiveValues.reporting_period ?? "";
    const amount = Number(
      (effectiveValues.wht_amount ?? "").replaceAll(",", ""),
    );
    const invoiceMismatch = Boolean(
      invoiceReference &&
      normalized(invoiceReference) !== normalized(recoveryCase.invoice),
    );
    const tinMismatch = Boolean(
      tin &&
      check("Beneficiary TIN") &&
      normalized(check("Beneficiary TIN")!.bookValue) !== normalized(tin),
    );
    const amountMismatch =
      Number.isFinite(amount) && Math.abs(amount - recoveryCase.amount) > 100;
    const periodMismatch = Boolean(
      period &&
      check("Reporting period") &&
      normalized(check("Reporting period")!.bookValue) !== normalized(period),
    );
    if (invoiceMismatch) return matchOutcomeForException("INVOICE_MISMATCH");
    if (tinMismatch)
      return matchOutcomeForException("BENEFICIARY_TIN_MISMATCH");
    if (amountMismatch) return matchOutcomeForException("AMOUNT_MISMATCH");
    if (periodMismatch) return matchOutcomeForException("PERIOD_MISMATCH");
    if (!invoiceReference || !tin || !period || !Number.isFinite(amount))
      return matchOutcomeForException("RECEIPT_FIELDS_MISSING");
    return matchOutcomeForException("NO_OPEN_EXCEPTION");
  };

  const submitReview = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const effectiveValues = {
      ...Object.fromEntries(
        data.fields.map((field) => [field.fieldName, field.effectiveValue]),
      ),
      ...values,
    };
    try {
      let outcome: ReviewOutcome;
      let eventId = `demo-${Date.now()}`;
      if (recoveryCase.sourceDocumentId) {
        const corrections = Object.fromEntries(
          changes.map((field) => [
            field.fieldName,
            values[field.fieldName] ?? "",
          ]),
        );
        const response = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            caseId: recoveryCase.id,
            action: "review-extraction",
            corrections,
            note,
          }),
        });
        const result = (await response.json()) as {
          error?: string;
          eventId?: string;
          outcome?: ReviewOutcome;
          effectiveValues?: Record<string, string>;
          reviewedAt?: string;
        };
        if (!response.ok || !result.outcome)
          throw new Error(
            result.error || "The extraction review could not be recorded",
          );
        outcome = result.outcome;
        eventId = result.eventId || eventId;
        Object.assign(effectiveValues, result.effectiveValues ?? {});
      } else {
        outcome = localOutcome(effectiveValues);
      }
      const reviewedAt = new Date().toISOString();
      setData((current) => ({
        ...current,
        fields: current.fields.map((field) => ({
          ...field,
          reviewedValue: effectiveValues[field.fieldName],
          effectiveValue: effectiveValues[field.fieldName],
        })),
        review: { completed: true, eventId, createdAt: reviewedAt },
      }));
      setValues(effectiveValues);
      setNote("");
      onReviewStateChange(true);
      onReviewComplete(effectiveValues, outcome);
      onNotify(
        changes.length
          ? "Corrections audited and deterministic matching rerun"
          : "Extraction review checkpoint recorded",
      );
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : "The extraction review could not be recorded",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="work-panel correction-panel">
      <div className="section-heading correction-heading">
        <div>
          <h2>Review extracted receipt</h2>
          <p>
            Compare source-grounded values, correct permitted fields and record
            the review checkpoint.
          </p>
        </div>
        <div className="correction-heading-actions">
          <span
            className={`review-state ${data.review.completed ? "complete" : "pending"}`}
          >
            {data.review.completed ? (
              <CheckCircle2 size={15} />
            ) : (
              <LockKeyhole size={15} />
            )}
            {data.review.completed
              ? "Audit recorded"
              : "Required before recognition"}
          </span>
          <button
            className="icon-button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? "Collapse extraction review"
                : "Expand extraction review"
            }
          >
            <ChevronRight
              size={18}
              className={expanded ? "chevron-open" : ""}
            />
          </button>
        </div>
      </div>

      {expanded &&
        (loading ? (
          <div
            className="review-skeleton"
            aria-label="Loading extraction review"
          >
            {[1, 2, 3].map((item) => (
              <span key={item} />
            ))}
          </div>
        ) : (
          <>
            <div className="source-provenance">
              <span className="document-icon">
                <FileText size={18} />
              </span>
              <div>
                <strong>{data.document?.fileName || "Receipt source"}</strong>
                <span>
                  Original retained · SHA-256{" "}
                  {data.document?.sha256.slice(0, 12) || "unavailable"}…
                </span>
              </div>
              <div>
                <span>Extractor</span>
                <strong>AI-assisted receipt extraction</strong>
              </div>
              <div>
                <span>Rules</span>
                <strong>{data.ruleVersion}</strong>
              </div>
            </div>

            {(data.document?.aiModel || data.document?.aiResponseId) && (
              <details className="audit-technical-details">
                <summary>Audit details</summary>
                <div>
                  <span>Provider model</span>
                  <strong>{data.document?.aiModel || "Not recorded"}</strong>
                </div>
                <div>
                  <span>Response reference</span>
                  <strong>
                    {data.document?.aiResponseId || "Not recorded"}
                  </strong>
                </div>
              </details>
            )}

            <div className="correction-legend" aria-hidden="true">
              <span>Field & source</span>
              <span>Original AI extraction</span>
              <span>Reviewer value</span>
            </div>
            <div className="correction-fields">
              {data.fields.map((field) => {
                const changed =
                  (values[field.fieldName] ?? "").trim() !==
                  field.effectiveValue.trim();
                return (
                  <div
                    className={`correction-row ${changed ? "changed" : ""}`}
                    key={field.id}
                  >
                    <div className="field-provenance">
                      <strong>
                        {reviewFieldLabels[field.fieldName] ??
                          field.fieldName.replaceAll("_", " ")}
                      </strong>
                      <span
                        className={`confidence-chip ${field.confidence < 70 ? "low" : ""}`}
                      >
                        {field.confidence}% confidence
                      </span>
                      <p>
                        <Quote size={13} /> “
                        {field.evidenceQuote || "No source snippet returned"}”{" "}
                        {field.pageNumber ? (
                          <small>p. {field.pageNumber}</small>
                        ) : null}
                      </p>
                    </div>
                    <div className="original-value">
                      <span>Original</span>
                      <strong>{field.originalValue || "Not extracted"}</strong>
                    </div>
                    <label className="review-input">
                      <span>Reviewer value {changed && <em>Edited</em>}</span>
                      <div>
                        <PencilLine size={15} />
                        <input
                          value={values[field.fieldName] ?? ""}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [field.fieldName]: event.target.value,
                            }))
                          }
                          disabled={!field.editable || saving}
                          aria-label={`Reviewer value for ${reviewFieldLabels[field.fieldName] ?? field.fieldName}`}
                        />
                      </div>
                    </label>
                  </div>
                );
              })}
            </div>

            <div className="review-footer">
              <label className="review-note">
                <span>
                  Review note{" "}
                  {noteRequired ? (
                    <em>
                      Required for {changes.length} correction
                      {changes.length === 1 ? "" : "s"}
                    </em>
                  ) : (
                    <small>Optional when confirming unchanged values</small>
                  )}
                </span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={
                    noteRequired
                      ? "Explain why the source supports this correction…"
                      : "Add context for the audit trail…"
                  }
                  aria-describedby="review-note-help"
                />
                <small id="review-note-help">
                  Stored with before and after values, source provenance, rule
                  outcome, reviewer, and timestamp.
                </small>
              </label>
              <div className="review-submit">
                <div>
                  <ShieldCheck size={16} />
                  <span>Original extraction remains unchanged.</span>
                </div>
                <button
                  className="primary-button"
                  disabled={!canSubmit}
                  onClick={() => void submitReview()}
                >
                  {saving ? (
                    <RefreshCw className="spin" size={17} />
                  ) : (
                    <RefreshCw size={17} />
                  )}
                  {saving
                    ? "Recording review…"
                    : changes.length
                      ? "Rerun match & record"
                      : "Confirm extraction"}
                </button>
              </div>
            </div>
          </>
        ))}
    </section>
  );
}
