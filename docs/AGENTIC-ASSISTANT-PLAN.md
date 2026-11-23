# WHT assistant: agentic build plan

## Goal

Let the assistant choose and use application tools across multiple steps to answer WHT recovery questions. Keep deterministic controls and practitioner decisions in the application, with a visible record of what the assistant did. All implementation described here is local until it is separately committed and deployed.

## Phase 1 — Grounded, read-only agent

- Allowlisted tools read portfolio totals, case search, case details, evidence metadata, recorded deterministic checks, and available workspace case owners.
- Model turns, tool calls, response size and wall time are bounded. Every query enforces the authenticated workspace and client; soft-deleted cases are excluded.
- Records, attachments and previous answers are untrusted context. Final structured answers can cite only sources actually inspected.
- Chat streams real tool activity. AI activity retains the job and tool results. The public synthetic demo is separate from live records.

**Acceptance:** A question can trigger multiple model-selected tools. Unsupported tools, invalid arguments, unavailable records and invented source labels fail closed. The model cannot change tax state or send correspondence.

## Phase 2 — Reviewable actions

Agreed actions are case notes, assignment, priority, due date (including explicitly clearing it), new open checklist items, and correspondence drafts. A scheduled internal follow-up also uses this approval flow.

- Proposal tools prepare one exact action per answer, after inspecting the affected case and version. Assignment resolves an active workspace owner on the server.
- Chat and the shared AI activity review queue show the affected case, exact effects, sources, case version, and a link to inspect case evidence.
- An admin, practitioner or reviewer approves or rejects the displayed proposal with a review note and preview hash. The server rechecks membership, client scope, case version and any selected owner inside the execution transaction.
- Approval applies once, advances the case version, and writes an audit event with the exact effects and actor. Audit failure rolls back approval and effects together. Rejection applies no proposed effects.
- Stored effects and reviewed decisions are immutable. Concurrent, duplicate, altered-preview and stale approvals are rejected. Related note/checklist/draft inserts invalidate older proposals.
- A correspondence approval saves the exact approved draft and recipient/channel metadata. No message is sent. Tax conclusions and status/outcome changes remain in the existing explicit human operations.
- External email has a separate human permission: prepare the exact approved draft, sender and one recipient, then approve or reject that displayed message. Draft approval and schedule approval never grant permission to send.

**Acceptance:** Each allowlisted action requires a fresh human decision, applies once and is auditable. A model request alone changes no operational records.

## Phase 3 — Durable investigations and scheduled internal follow-ups

- Cloudflare Workflows run read-only investigations after a browser disconnect. Each run has at most two model attempts, four model turns and six tools per attempt, a 55-second agent deadline, and bounded Workflow step retries.
- A person approves the exact follow-up case, question and timestamp (with timezone), within 90 days. The Workflow sleeps until that time and then rechecks access before tools and publication. Follow-up tools are restricted to the approved case.
- Recurring permission displays the case, question, first run, cadence of 1–30 days and expiry within 90 days. One approval permits those read-only occurrences until paused, revoked, expired or suspended by access loss. Schedule changes and resuming require a newly approved permission; the old permission cannot be reactivated. Missed occurrences are skipped without a burst of backlogged runs.
- A D1 dispatch outbox and five-minute recovery trigger use a deterministic Workflow instance ID. Uncertain create responses and interrupted final dispatch attempts are reconciled; three unavailable launch attempts fail visibly.
- Requesters and authorised reviewers can cancel running or sleeping work. Persistent cancellation prevents later reads and publication even if platform termination is unavailable.
- Findings stay in the original conversation. Reconnection restores progress and results without duplicating actions or completion audit records.
- Reviewers inspect other users' full run history in the active client through AI activity. An append-only journal retains tool arguments, bounded results, source labels, attempts, failures and cancellation. Non-reviewer access to run history is restricted to the requester.
- A separate append-only permission history retains schedule approvals, changes, occurrence IDs, missed slots, pauses, revocation and expiry. Permission is checked before every model call, tool and publication, including current access for its original approver.

**Acceptance:** Synthetic runtime tests cover sleep/wake, reconnect, replay, revoked membership/user/client/case access, scope enforcement, cancellation, retries and launch recovery. Reviewers can inspect successful, failed and canceled runs.

## Human-approved email delivery

- A server-configured Resend sender is disabled by default. Sender and credential configuration is independent of other projects; no domain or shared credential is configured for WHT.
- An admin, practitioner or reviewer prepares a send permission from an approved email draft. Its immutable preview binds the exact sender, one recipient, subject, body, draft version and case version to a hash. Only a separate explicit approval sends it.
- Approval consumes one permission and records its audit atomically before contacting Resend. Current scope, reviewer access and draft/case versions are rechecked before the provider request. Concurrent, stale and altered-preview decisions cannot send.
- A unique provider idempotency key accompanies the request. Provider acceptance is recorded as acceptance, not confirmed delivery. Timeout, interrupted response or recording failure stays uncertain and blocks further sends from the same draft. Cron never sends or retries email. A definite provider rejection permits a new human-reviewed permission.
- The model and recurring schedules have no delivery tool. Receiving mail, delivery webhooks, SMS and tax-authority submission are outside this implementation.

## Remaining boundaries

- Bulk AI jobs are not implemented. Production email remains disabled until WHT has its own verified sender and server-side Resend credential.
- History lost by the earlier summary-only implementation cannot be reconstructed. Migration 0009 retains surviving legacy snapshots; full event history starts with the new implementation.
- Local tests use a stubbed model. Live provider behaviour and deployed identity/Workflow/cron bindings require separate environment verification.
- Review migrations 0007–0010 and the generated Workflow/cron configuration before any remote migration or deployment. Take a database backup/export and review the target account, identity proxy, approved rules and retention policy first.

See [the verification record](AGENTIC-ASSISTANT-VERIFICATION.md) for current checks and deployment limits.
