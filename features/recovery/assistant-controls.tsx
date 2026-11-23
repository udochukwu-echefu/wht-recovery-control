"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActionProposalPreview } from "@/lib/ai/action-contracts";
import { ActionProposalCard } from "./action-proposal";
import { RecurringFollowups } from "./recurring-followups";
import { DeliveryControls } from "./delivery-controls";

type Run = { id: string; userId: string; question: string; status: string; caseId: string | null; scheduledFor: string | null; createdAt: string; errorMessage: string | null };
type RunEvent = { id: number; eventType: string; attempt: number; createdAt: string; payload: unknown };
type RunDetail = { run: Run; events: RunEvent[]; canCancel: boolean };
type ProposalPage = { proposals: ActionProposalPreview[]; canReview: boolean; nextCursor: string | null };
type RunPage = { runs: Run[]; nextCursor: string | null };

async function readResponse<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) {
    const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "Assistant controls could not be loaded.";
    throw new Error(message);
  }
  return value as T;
}

export function AssistantControls({ onOpenCase, onActionApplied }: { onOpenCase: (id: string) => void; onActionApplied?: () => void }) {
  const [proposals, setProposals] = useState<ActionProposalPreview[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [proposalCursor, setProposalCursor] = useState<string | null>(null);
  const [runCursor, setRunCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const [proposalPage, runPage] = await Promise.all([
      fetch("/api/assistant/proposals", { signal }).then(readResponse<ProposalPage>),
      fetch("/api/assistant/runs", { signal }).then(readResponse<RunPage>),
    ]);
    if (signal?.aborted) return;
    setProposals(proposalPage.proposals); setCanReview(proposalPage.canReview); setProposalCursor(proposalPage.nextCursor);
    setRuns(runPage.runs); setRunCursor(runPage.nextCursor);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal)).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Assistant controls could not be loaded.");
    });
    return () => controller.abort();
  }, [load]);

  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Assistant controls could not be loaded."); }
    finally { setBusy(false); }
  };
  const inspect = async (id: string) => { setDetail(await fetch(`/api/assistant/runs?id=${encodeURIComponent(id)}`).then(readResponse<RunDetail>)); };

  return <section className="assistant-controls" aria-label="Assistant approvals and investigation history">
    <div className="section-heading"><div><h2>Approvals and investigations</h2><p>Inspect exact effects and the saved history for the active client.</p></div><button className="secondary-button" type="button" disabled={busy} onClick={() => void perform(async () => { await load(); if (detail) await inspect(detail.run.id); })}>Refresh</button></div>
    {error && <p role="alert">{error}</p>}
    <div className="assistant-controls-grid">
      <div><h3>Action proposals</h3>
        {proposals.length === 0 && <p>No pending proposals.</p>}
        {proposals.map((proposal) => <ActionProposalCard key={proposal.id} proposal={proposal} canReview={canReview} onOpenCase={onOpenCase} onReviewed={(reviewed) => {
          setProposals((current) => current.map((item) => item.id === reviewed.id ? reviewed : item));
          if (reviewed.status === "approved") onActionApplied?.();
          if (reviewed.actionType === "schedule_followup") void perform(async () => {
            const page = await fetch("/api/assistant/runs").then(readResponse<RunPage>); setRuns(page.runs); setRunCursor(page.nextCursor);
          });
        }} />)}
        {proposalCursor && <button className="secondary-button" type="button" disabled={busy} onClick={() => void perform(async () => {
          const page = await fetch(`/api/assistant/proposals?cursor=${encodeURIComponent(proposalCursor)}`).then(readResponse<ProposalPage>);
          setProposals((current) => [...current, ...page.proposals]); setProposalCursor(page.nextCursor);
        })}>Load more proposals</button>}
      </div>
      <div><h3>Investigation history</h3>
        {runs.length === 0 && <p>No recorded investigations.</p>}
        <ul className="assistant-run-list">{runs.map((run) => <li key={run.id}><button type="button" disabled={busy} onClick={() => void perform(() => inspect(run.id))}><strong>{run.question}</strong><small>{run.status}{run.scheduledFor ? ` · Scheduled for ${run.scheduledFor}` : ""}{run.caseId ? ` · ${run.caseId}` : ""}</small></button></li>)}</ul>
        {runCursor && <button className="secondary-button" type="button" disabled={busy} onClick={() => void perform(async () => {
          const page = await fetch(`/api/assistant/runs?cursor=${encodeURIComponent(runCursor)}`).then(readResponse<RunPage>);
          setRuns((current) => [...current, ...page.runs]); setRunCursor(page.nextCursor);
        })}>Load older runs</button>}
      </div>
    </div>
    <RecurringFollowups onOpenCase={onOpenCase} onActionApplied={onActionApplied} />
    <DeliveryControls onOpenCase={onOpenCase} onActionApplied={onActionApplied} />
    {detail && <section className="assistant-run-detail" aria-label="Full investigation history">
      <div className="section-heading"><h3>{detail.run.question}</h3><button className="secondary-button" type="button" onClick={() => setDetail(null)}>Close history</button></div>
      <p>Status: {detail.run.status}. Requested by {detail.run.userId}. {detail.run.errorMessage}</p>
      {detail.canCancel && ["queued", "running"].includes(detail.run.status) && <button className="secondary-button" type="button" disabled={busy} onClick={() => void perform(async () => {
        await fetch("/api/assistant/runs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: detail.run.id }) }).then(readResponse);
        await inspect(detail.run.id); await load();
      })}>Cancel investigation</button>}
      {detail.events.map((event) => <details key={event.id}><summary>{event.eventType.replaceAll("_", " ")} · {event.createdAt}{event.attempt ? ` · Attempt ${event.attempt}` : ""}</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details>)}
      {detail.events.some((event) => event.eventType === "legacy_snapshot") && <p>Older runs retain their surviving summary. Details lost before full history recording was added are unavailable.</p>}
    </section>}
  </section>;
}
