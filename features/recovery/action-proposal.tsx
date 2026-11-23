"use client";

import { useState } from "react";
import { actionDescription, actionTitles, type ActionProposalPreview } from "@/lib/ai/action-contracts";

export function ActionProposalCard({ proposal, canReview, onReviewed, onOpenCase }: {
  proposal: ActionProposalPreview;
  canReview: boolean;
  onReviewed: (proposal: ActionProposalPreview) => void;
  onOpenCase: (id: string) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const review = async (decision: "approve" | "reject") => {
    if (note.trim().length < 8) { setError("Add a review note of at least 8 characters."); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/assistant/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposalId: proposal.id, previewHash: proposal.previewHash, decision, note: note.trim() }) });
      const result = await response.json() as { status?: ActionProposalPreview["status"]; reviewedAt?: string; error?: string };
      if (!response.ok || !result.status) throw new Error(result.error || "The proposal could not be reviewed.");
      onReviewed({ ...proposal, status: result.status, reviewedAt: result.reviewedAt });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Review failed."); }
    finally { setBusy(false); }
  };
  const schedule = "runAt" in proposal.payload ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(proposal.payload.runAt)) : null;
  return <div className="overview-chat-proposal">
    <div className="overview-chat-proposal-head"><strong>Proposed {actionTitles[proposal.actionType].toLowerCase()}</strong><span>{proposal.status === "pending" ? "Awaiting review" : proposal.status === "approved" ? "Approved and applied" : "Rejected"}</span></div>
    <small>{proposal.customer} · {proposal.caseId}</small>
    <p>{actionDescription(proposal.actionType, proposal.payload)}</p>
    {schedule && <small>Scheduled time: {schedule} WAT (Africa/Lagos).</small>}
    <small>Sources: {proposal.sourceLabels.join(", ")}. Case version: {proposal.caseUpdatedAt}.</small>
    <div className="overview-chat-message-actions"><button type="button" onClick={() => onOpenCase(proposal.caseId)}>Review case evidence</button></div>
    <small>{proposal.status === "pending" ? "Approval applies these exact effects once." : proposal.status === "approved" ? "These exact effects were approved and recorded." : "No proposed effects were applied."} {proposal.actionType === "communication_draft" ? "The draft is retained in this workspace. No message is sent." : proposal.actionType === "schedule_followup" ? "The follow-up reads this case and returns findings in this conversation." : ""}</small>
    {proposal.status === "pending" && canReview && <div className="overview-chat-proposal-review">
      <label htmlFor={`proposal-review-${proposal.id}`}>Review note</label>
      <textarea id={`proposal-review-${proposal.id}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={1_000} placeholder="Why are you approving or rejecting these effects?" disabled={busy} />
      <div><button type="button" disabled={busy} onClick={() => void review("approve")}>{busy ? "Recording decision…" : "Approve exact effects"}</button><button type="button" disabled={busy} onClick={() => void review("reject")}>Reject</button></div>
    </div>}
    {error && <small className="overview-chat-proposal-error" role="alert">{error}</small>}
  </div>;
}
