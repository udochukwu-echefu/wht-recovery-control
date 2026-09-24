"use client";

import {
  type LedgerTargetField,
  type AiStatus,
  type LedgerWorkflow,
  type LedgerMappingItem,
  type EvidenceWorkflow,
} from "./types";
import { ChangeEvent, useState, useRef } from "react";
import {
  FileText,
  RefreshCw,
  Upload,
  Paperclip,
  BookOpenCheck,
  Check,
  FileCheck2,
  CircleAlert,
  CheckCircle2,
  LockKeyhole,
  ShieldCheck,
  ReceiptText,
} from "lucide-react";
import { CustomSelect } from "./custom-select";

const ledgerFieldOptions: Array<{ value: LedgerTargetField; label: string }> = [
  { value: "unmapped", label: "Do not import" },
  { value: "customer_name", label: "Customer name *" },
  { value: "customer_tin", label: "Customer TIN" },
  { value: "invoice_reference", label: "Invoice reference *" },
  { value: "invoice_gross_amount", label: "Invoice gross amount *" },
  { value: "payment_net_amount", label: "Payment net amount *" },
  { value: "payment_date", label: "Payment date *" },
  { value: "reporting_period", label: "Reporting period *" },
  { value: "expected_wht_amount", label: "Expected WHT amount" },
  { value: "currency", label: "Currency" },
  { value: "entity_reference", label: "Entity reference" },
];

export function ImportsView({
  batches,
  ledgerInputRef,
  evidenceInputRef,
  onImport,
  onReceiptText,
  isImporting,
  uploadProgress,
  aiStatus,
  ledgerWorkflow,
  ledgerMappings,
  onMappingChange,
  onValidateLedger,
  onImportLedger,
  isLedgerActionRunning,
  evidenceWorkflow,
  evidenceCaseId,
  evidenceReviewNote,
  onEvidenceCaseChange,
  onEvidenceReviewNoteChange,
  onConfirmEvidence,
  isEvidenceConfirming,
  onNotify,
  onViewCases,
}: {
  batches: { name: string; rows: number; status: string; time: string }[];
  ledgerInputRef: React.RefObject<HTMLInputElement | null>;
  evidenceInputRef: React.RefObject<HTMLInputElement | null>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onReceiptText: (text: string) => Promise<void>;
  isImporting: boolean;
  uploadProgress: number;
  aiStatus: AiStatus;
  ledgerWorkflow: LedgerWorkflow | null;
  ledgerMappings: LedgerMappingItem[];
  onMappingChange: (mappings: LedgerMappingItem[]) => void;
  onValidateLedger: () => void;
  onImportLedger: () => void;
  isLedgerActionRunning: boolean;
  evidenceWorkflow: EvidenceWorkflow | null;
  evidenceCaseId: string;
  evidenceReviewNote: string;
  onEvidenceCaseChange: (caseId: string) => void;
  onEvidenceReviewNoteChange: (note: string) => void;
  onConfirmEvidence: () => void;
  isEvidenceConfirming: boolean;
  onNotify: (message: string) => void;
  onViewCases: () => void;
}) {
  const [receiptText, setReceiptText] = useState("");
  const receiptTextRef = useRef<HTMLTextAreaElement>(null);

  const submitReceiptText = async () => {
    const text = receiptText.trim();
    if (text.length < 20) return;
    await onReceiptText(text);
    setReceiptText("");
  };

  return (
    <>
      <section className="page-heading compact-heading">
        <div>
          <h1>Data intake</h1>
          <p>
            Import ledger records and attach supporting evidence. Originals
            remain unchanged and traceable.
          </p>
        </div>
      </section>

      <div className="intake-grid">
        <section className="upload-workflow" aria-labelledby="upload-heading">
          <div className="section-heading">
            <div>
              <h2 id="upload-heading">Import source records</h2>
              <p>
                Choose the source type so the correct validation rules are
                applied.
              </p>
            </div>
          </div>
          <div className="upload-options">
            <div className="upload-option">
              <span className="document-icon">
                <FileText size={19} />
              </span>
              <div>
                <h3>Ledger records</h3>
                <p>Invoices, payment values and customer identifiers.</p>
                <small>CSV · maximum 1 MB during pilot</small>
              </div>
              <input
                ref={ledgerInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onImport}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
              <button
                className="primary-button"
                onClick={() => ledgerInputRef.current?.click()}
                disabled={isImporting}
              >
                {isImporting ? (
                  <RefreshCw className="spin" size={17} />
                ) : (
                  <Upload size={17} />
                )}
                Import ledger
              </button>
            </div>
            <div className="upload-option">
              <span className="document-icon">
                <Paperclip size={19} />
              </span>
              <div>
                <h3>Supporting evidence</h3>
                <p>
                  WHT receipts and source documents retained for provenance.
                </p>
                <small>
                  PDF, PNG, JPG, WEBP or TXT · maximum 1 MB during pilot
                </small>
              </div>
              <input
                ref={evidenceInputRef}
                type="file"
                accept=".txt,.pdf,.png,.jpg,.jpeg,.webp,text/plain,application/pdf,image/png,image/jpeg,image/webp"
                onChange={onImport}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
              <button
                className="secondary-button"
                onClick={() => evidenceInputRef.current?.click()}
                disabled={isImporting}
              >
                {isImporting ? (
                  <RefreshCw className="spin" size={17} />
                ) : (
                  <Paperclip size={17} />
                )}
                Attach evidence
              </button>
            </div>
          </div>
          {uploadProgress > 0 && (
            <div
              className="upload-progress"
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadProgress}
            >
              <span style={{ width: `${uploadProgress}%` }} />
              <small>
                {uploadProgress === 100
                  ? "Upload complete"
                  : `Validating source · ${uploadProgress}%`}
              </small>
            </div>
          )}
        </section>

        <aside className="intake-guide">
          <div className="section-heading">
            <div>
              <h2>Minimum ledger fields</h2>
            </div>
            <BookOpenCheck size={19} />
          </div>
          <ul>
            <li>
              <Check size={16} /> Invoice reference and gross amount
            </li>
            <li>
              <Check size={16} /> Customer name and beneficiary TIN
            </li>
            <li>
              <Check size={16} /> Payment date and net amount
            </li>
          </ul>
          <div
            className={`ai-readiness ${aiStatus.configured ? "ready" : "setup"}`}
          >
            {aiStatus.configured ? (
              <FileCheck2 size={16} />
            ) : (
              <CircleAlert size={16} />
            )}
            <div>
              <strong>
                {aiStatus.configured
                  ? aiStatus.demoFallback
                    ? "Demo-mode receipt extraction available"
                    : "AI-assisted receipt extraction available"
                  : "Receipt extraction is temporarily unavailable"}
              </strong>
              <span>
                {aiStatus.configured
                  ? aiStatus.demoFallback
                    ? "Deterministic pilot fixtures are active. Outputs remain reviewable and clearly recorded in AI activity."
                    : "Extracted fields still require deterministic checks and practitioner review."
                  : "Attach the original now and contact the workspace administrator."}
              </span>
            </div>
          </div>
          <p>
            Column mapping and validation run before any recovery case is
            created.
          </p>
        </aside>
      </div>

      {ledgerWorkflow && (
        <section
          className="ledger-review"
          aria-labelledby="ledger-review-heading"
        >
          <div className="ledger-review-head">
            <div>
              <h2 id="ledger-review-heading">Review ledger mapping</h2>
              <p>
                {ledgerWorkflow.rowCount} source rows · AI suggestions are
                provisional until you confirm and validate them.
              </p>
            </div>
            <span
              className={`batch-status ${ledgerWorkflow.status === "imported" || ledgerWorkflow.validation?.valid ? "complete" : "processing"}`}
            >
              {ledgerWorkflow.status.replaceAll("_", " ")}
            </span>
          </div>

          <ol className="workflow-steps" aria-label="Ledger import stages">
            {["Upload", "Preview", "Map", "Validate", "Import"].map(
              (step, index) => {
                const active =
                  ledgerWorkflow.status === "imported"
                    ? index <= 4
                    : ledgerWorkflow.validation?.valid
                      ? index <= 3
                      : index <= 2;
                return (
                  <li className={active ? "complete" : ""} key={step}>
                    <span>{active ? <Check size={14} /> : index + 1}</span>
                    {step}
                  </li>
                );
              },
            )}
          </ol>

          <div className="mapping-layout">
            <div className="mapping-editor">
              <div className="mapping-header">
                <span>Source column</span>
                <span>Map to</span>
                <span>Suggestion</span>
              </div>
              {ledgerMappings.map((mapping, index) => (
                <div className="mapping-row" key={mapping.sourceColumn}>
                  <span>
                    <strong>{mapping.sourceColumn}</strong>
                    <small>
                      {ledgerWorkflow.detectedTypes[mapping.sourceColumn] ??
                        "text"}
                    </small>
                  </span>
                  <CustomSelect
                    value={mapping.targetField}
                    disabled={
                      ledgerWorkflow.status === "imported" ||
                      isLedgerActionRunning
                    }
                    onChange={(targetField) =>
                      onMappingChange(
                        ledgerMappings.map((item, mappingIndex) =>
                          mappingIndex === index
                            ? { ...item, targetField }
                            : item,
                        ),
                      )
                    }
                    ariaLabel={`Map ${mapping.sourceColumn}`}
                    options={ledgerFieldOptions}
                  />
                  <span className="mapping-reason">
                    {mapping.confidence !== undefined
                      ? `${mapping.confidence}%`
                      : "Manual"}
                    <small>{mapping.reason || "Reviewer selected"}</small>
                  </span>
                </div>
              ))}
            </div>

            <div className="ledger-preview-wrap">
              <h3>Source preview</h3>
              <div className="table-wrap">
                <table className="ledger-preview-table">
                  <thead>
                    <tr>
                      {ledgerWorkflow.headers.map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerWorkflow.preview.slice(0, 10).map((row, index) => (
                      <tr key={index}>
                        {ledgerWorkflow.headers.map((header) => (
                          <td key={header}>{row[header] || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ledgerWorkflow.truncated && (
                <p className="preview-note">
                  Preview limited to the first rows. Validation covers the
                  complete file.
                </p>
              )}
            </div>
          </div>

          {(ledgerWorkflow.mapping.warnings.length > 0 ||
            ledgerWorkflow.validation) && (
            <div
              className={`validation-summary ${ledgerWorkflow.validation?.valid ? "valid" : ""}`}
            >
              {ledgerWorkflow.validation?.valid ? (
                <CheckCircle2 size={18} />
              ) : (
                <CircleAlert size={18} />
              )}
              <div>
                <strong>
                  {ledgerWorkflow.validation?.valid
                    ? "Deterministic validation passed"
                    : ledgerWorkflow.validation
                      ? "Resolve validation issues"
                      : "Review mapping warnings"}
                </strong>
                <p>
                  {ledgerWorkflow.validation
                    ? `${ledgerWorkflow.validation.validRows} valid rows · ${ledgerWorkflow.validation.rejectedRows} rejected`
                    : "No recovery cases have been created."}
                </p>
                {[
                  ...(ledgerWorkflow.mapping.warnings ?? []),
                  ...(ledgerWorkflow.validation?.errors ?? []),
                ]
                  .slice(0, 8)
                  .map((warning, index) => {
                    const message =
                      typeof warning === "string"
                        ? warning
                        : `${warning.column || "Ledger"}: ${warning.message}${warning.affectedRows?.length ? ` (rows ${warning.affectedRows.join(", ")})` : ""}`;
                    return <small key={`${message}-${index}`}>{message}</small>;
                  })}
              </div>
            </div>
          )}

          <div className="ledger-actions">
            <p>
              <LockKeyhole size={16} /> Mapping confirmation is recorded in the
              audit trail. Expected WHT remains a deterministic payment-gap
              calculation.
            </p>
            {ledgerWorkflow.status !== "imported" &&
              !ledgerWorkflow.validation?.valid && (
                <button
                  className="primary-button"
                  onClick={onValidateLedger}
                  disabled={isLedgerActionRunning}
                >
                  {isLedgerActionRunning ? (
                    <RefreshCw className="spin" size={17} />
                  ) : (
                    <Check size={17} />
                  )}
                  Confirm mapping and validate
                </button>
              )}
            {ledgerWorkflow.status !== "imported" &&
              ledgerWorkflow.validation?.valid && (
                <button
                  className="primary-button"
                  onClick={onImportLedger}
                  disabled={isLedgerActionRunning}
                >
                  {isLedgerActionRunning ? (
                    <RefreshCw className="spin" size={17} />
                  ) : (
                    <Upload size={17} />
                  )}
                  Create candidate cases
                </button>
              )}
            {ledgerWorkflow.status === "imported" && (
              <span className="review-state complete">
                <CheckCircle2 size={16} /> Imported
              </span>
            )}
          </div>
        </section>
      )}

      {evidenceWorkflow && (
        <section
          className="evidence-review-workflow"
          aria-labelledby="evidence-review-heading"
        >
          <div className="ledger-review-head">
            <div>
              <h2 id="evidence-review-heading">Review extracted evidence</h2>
              <p>
                Original content, field provenance and ranked candidates remain
                separate until you confirm a link.
              </p>
            </div>
            <span className="batch-status processing">
              Practitioner decision required
            </span>
          </div>
          <div className="classification-strip">
            <div>
              <span>Document type</span>
              <strong>
                {evidenceWorkflow.classification.documentType.replaceAll(
                  "_",
                  " ",
                )}
              </strong>
            </div>
            <div>
              <span>Classification confidence</span>
              <strong>{evidenceWorkflow.classification.confidence}%</strong>
            </div>
            <div>
              <span>Duplicate check</span>
              <strong>
                {evidenceWorkflow.duplicate
                  ? `Possible duplicate · ${evidenceWorkflow.duplicate.fileName ?? "existing document"}`
                  : "No exact duplicate found"}
              </strong>
            </div>
            <div>
              <span>Content safety</span>
              <strong>
                {evidenceWorkflow.untrustedInstructionsDetected
                  ? "Untrusted instructions ignored"
                  : "No instruction-like text detected"}
              </strong>
            </div>
          </div>
          {evidenceWorkflow.extraction ? (
            <div className="evidence-review-grid">
              <div className="extraction-list">
                <h3>Extraction and provenance</h3>
                {evidenceWorkflow.extraction.fields.map((field) => (
                  <div className="extraction-field" key={field.fieldName}>
                    <div>
                      <strong>{field.fieldName.replaceAll("_", " ")}</strong>
                      <span>{field.value || "Not located"}</span>
                    </div>
                    <span className="field-confidence">
                      {field.confidence}%
                    </span>
                    <small>
                      “{field.sourceQuote || "No supporting quote"}”
                      {field.pageNumber ? ` · page ${field.pageNumber}` : ""}
                    </small>
                  </div>
                ))}
              </div>
              <div className="candidate-review">
                <h3>Candidate cases</h3>
                <p>{evidenceWorkflow.uncertainty}</p>
                <div className="candidate-list">
                  {evidenceWorkflow.candidates.length ? (
                    evidenceWorkflow.candidates.map((candidate) => (
                      <label
                        className={
                          evidenceCaseId === candidate.caseId ? "selected" : ""
                        }
                        key={candidate.caseId}
                      >
                        <input
                          type="radio"
                          name="candidate-case"
                          value={candidate.caseId}
                          checked={evidenceCaseId === candidate.caseId}
                          onChange={() =>
                            onEvidenceCaseChange(candidate.caseId)
                          }
                        />
                        <span>
                          <strong>
                            #{candidate.rank} ·{" "}
                            {candidate.case?.customer ?? candidate.caseId}
                          </strong>
                          <small>
                            {candidate.case?.invoiceReference ??
                              candidate.caseId}{" "}
                            · {candidate.confidence}% ranking confidence
                          </small>
                          <small>
                            {candidate.reasons.join(" · ") ||
                              "No strong matching factor"}
                          </small>
                          {candidate.conflicts.length > 0 && (
                            <small className="conflict">
                              Conflict: {candidate.conflicts.join(" · ")}
                            </small>
                          )}
                        </span>
                      </label>
                    ))
                  ) : (
                    <div className="empty-candidates">
                      <CircleAlert size={18} /> No eligible case was ranked.
                      Continue through manual review.
                    </div>
                  )}
                </div>
                <label className="review-note evidence-note">
                  <span>Reviewer decision note</span>
                  <textarea
                    value={evidenceReviewNote}
                    onChange={(event) =>
                      onEvidenceReviewNoteChange(event.target.value)
                    }
                    placeholder="Explain why this document belongs to the selected case (required)."
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={
                    !evidenceCaseId ||
                    evidenceReviewNote.trim().length < 8 ||
                    isEvidenceConfirming
                  }
                  onClick={onConfirmEvidence}
                >
                  {isEvidenceConfirming ? (
                    <RefreshCw className="spin" size={17} />
                  ) : (
                    <ShieldCheck size={17} />
                  )}
                  Confirm candidate and run controls
                </button>
                <small className="decision-warning">
                  This records your selection, then runs deterministic
                  comparisons. It does not recognise or close the case.
                </small>
              </div>
            </div>
          ) : (
            <div className="manual-entry-state">
              <CircleAlert size={19} />
              <div>
                <strong>Manual field entry required</strong>
                <p>{evidenceWorkflow.uncertainty}</p>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="receipt-text-panel">
        <div>
          <h2>Paste receipt text or OCR output</h2>
          <p>
            Use text from a digital receipt or OCR scan. Attach the original
            separately to retain source provenance.
          </p>
        </div>
        <label>
          <span className="sr-only">WHT receipt text</span>
          <textarea
            ref={receiptTextRef}
            value={receiptText}
            onChange={(event) => setReceiptText(event.target.value)}
            placeholder="Receipt no: RCP-22814&#10;Beneficiary TIN: 01234567-0001&#10;Invoice: INV-1042&#10;WHT amount: NGN 750,000&#10;Period: March 2026"
          />
        </label>
        <button
          className="primary-button"
          disabled={isImporting || receiptText.trim().length < 20}
          onClick={() => void submitReceiptText()}
        >
          {isImporting ? (
            <RefreshCw className="spin" size={17} />
          ) : (
            <ReceiptText size={17} />
          )}
          Extract receipt fields
        </button>
      </section>

      <section className="batch-panel">
        <div className="section-heading">
          <div>
            <h2>Recent batches</h2>
            <p>Validation status and the next available action.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="batch-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Source</th>
                <th>Status</th>
                <th>Records</th>
                <th>Date</th>
                <th>Next action</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch, index) => {
                const normalizedStatus = batch.status.toLowerCase();
                const failed = normalizedStatus.includes("failed");
                const processing = normalizedStatus.includes("processing");
                const textNeeded = normalizedStatus.includes(
                  "text extraction required",
                );
                const extractionUnavailable = normalizedStatus.includes(
                  "ai configuration required",
                );
                const statusLabel = failed
                  ? "Failed"
                  : processing
                    ? "Validating"
                    : textNeeded
                      ? "Text needed"
                      : extractionUnavailable
                        ? "Extraction unavailable"
                        : normalizedStatus.includes("validated")
                          ? "Validated"
                          : batch.status;
                const ledger = batch.name.toLowerCase().endsWith(".csv");
                return (
                  <tr key={`${batch.name}-${index}`}>
                    <td>
                      <strong>{batch.name}</strong>
                    </td>
                    <td>{ledger ? "Ledger" : "Evidence"}</td>
                    <td>
                      <span
                        className={`batch-status ${failed ? "failed" : processing || textNeeded || extractionUnavailable ? "processing" : "complete"}`}
                      >
                        {statusLabel}
                      </span>
                    </td>
                    <td>{batch.rows || "—"}</td>
                    <td>{batch.time}</td>
                    <td>
                      {failed ? (
                        <button
                          className="text-button"
                          onClick={() =>
                            (ledger
                              ? ledgerInputRef
                              : evidenceInputRef
                            ).current?.click()
                          }
                        >
                          Retry
                        </button>
                      ) : processing ? (
                        <span className="muted-action">Validating</span>
                      ) : textNeeded ? (
                        <button
                          className="text-button"
                          onClick={() => receiptTextRef.current?.focus()}
                        >
                          Add receipt text
                        </button>
                      ) : extractionUnavailable ? (
                        <button
                          className="text-button"
                          onClick={() =>
                            onNotify(
                              "Contact the workspace administrator to restore receipt extraction",
                            )
                          }
                        >
                          Contact administrator
                        </button>
                      ) : (
                        <button className="text-button" onClick={onViewCases}>
                          Review cases
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
