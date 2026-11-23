# Agentic assistant: local verification

Verified on 9 October 2026 in `/Users/udo/Documents/ChatGPT/tax`, on `agent/wht-recovery-control`. This record describes local work. No commit, push, remote migration or deployment was performed; GitHub and Cloudflare state were not assumed to contain these changes.

## Implemented scope

Phase 1 remains a bounded, source-validated, read-only agent. Every operational query uses the authenticated workspace and active client. Unsupported tools, extra arguments and fabricated sources fail closed.

The agreed Phase 2 actions now cover case notes, assignment, priority, due date (including clearing it), a new open checklist item, and an exact correspondence draft. Scheduled internal follow-ups use the same approval mechanism. The assistant prepares one proposal per answer and applies no effects itself. Chat and AI activity show exact effects, sources, the case version and a case-evidence link.

An admin, practitioner or reviewer approves or rejects the displayed preview with a review note. Execution binds the decision to the preview hash and rechecks current membership, active client, case version and assignment eligibility inside one D1 transaction. Effects, the decision and its audit event commit together. Duplicate/concurrent/stale approvals are rejected, and failed audit writes roll back the effects. Proposal effects and reviewed decisions are immutable. Related note/checklist/draft inserts advance the case version. Operational updates no longer reset displayed recovery ageing.

Correspondence approval retains the exact draft, channel and recipient metadata in the workspace. It does not send a message. Tax conclusions, case stages, recognition, utilisation, closure and external communication stay in explicit human operations; the agent has no tools for them.

The separate email permission flow prepares an immutable snapshot of the approved draft, sender, one recipient and case/draft versions. A fresh human approval consumes that permission and its audit before one Resend request. Current access and scope are checked again before that request. Provider acceptance is distinguished from confirmed delivery; interrupted responses and recording failures are retained as uncertain and never automatically resent. A definite provider rejection permits only a newly reviewed permission. Sending is disabled, `EMAIL_FROM` is blank, and no production Resend credential is present in this WHT workspace.

Phase 3 now includes approved one-time internal follow-ups within 90 days. A Workflow sleeps until the approved timestamp, rechecks access on wake and before tools/publication, inspects only the approved case, and saves findings in the original conversation. Background runs cannot prepare actions. Persistent cancellation prevents further reads and publication, including cancellation during a provider request.

Recurring follow-ups use a standing human permission for the displayed case, question, first run, interval of 1–30 days and expiry within 90 days. Cron materialises one deterministic current occurrence and skips missed slots. Pause/revoke cancels active occurrences. Changes and resuming create a new proposal and require another exact approval; the old permission is immutable and cannot be reactivated. Current requester and approving reviewer access are checked at dispatch, before model calls/tools and before publication. Access loss suspends the schedule without silently resuming it after restoration. Reviewers can inspect append-only permission history and each occurrence's complete run history.

Reviewers can inspect other users' complete new run histories within the active client. An append-only journal records tool arguments, bounded results, source labels, attempts, failures, dispatch and cancellation. Requesters retain access to their own histories. Reconnect and Workflow replay reuse saved results without a second model execution or duplicate completion audit. Each run is limited to two model attempts; each attempt has four turns, six tools and a 55-second deadline.

An atomic D1 outbox records approved/requested runs before dispatch. A five-minute cron recovers interrupted starts using the same Workflow instance ID. Uncertain create responses and interrupted final dispatch claims are reconciled. Three unavailable launch attempts fail visibly.

## Current checks

The final check results are recorded below after the last code changes:

| Check | Result |
| --- | --- |
| `npm run build` | Passed; final `npm test` includes a clean build |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | Passed: 122 tests, 0 failures, 0 skipped |
| `git diff --check` | Passed; final check repeated after this record |
| Wrangler deployment dry run | Passed; no upload or deployment |

The 75 added tests exercise real HTTP route handlers and native Miniflare D1/Workflows using isolated synthetic users, workspaces, clients and cases, plus pure argument/presentation contracts. Temporary databases and Workflow instances are removed after each scenario. Model and Resend requests are intercepted with fake keys and synthetic replies; no live model, real email or production records are used. The full command applies migrations only under `.wrangler/state/test` and reruns the existing domain, authentication-boundary and server-rendering tests. The final test log is `/private/tmp/wht-agentic-final-tests-20261009.log`.

Coverage includes approval/rejection for every action, concurrent and stale approvals, altered previews, spoofed browser actors/effects, revoked owner/membership/client access, atomic rollback, model-selected proposals with no direct effects, fabricated/cross-client sources, migration preservation, append-only history, sleep/wake, reconnect/replay, canceled sleeping/active runs, retry history and dispatch recovery. Invalid dates, missing timezones, hidden status effects and incorrectly typed enum values are rejected.

New recurrence/delivery coverage includes standing permission deduplication, missed-slot skipping, expiry, permission pagination, paused/in-flight cancellation, changed/resumed permission approval, stale replacement versions, approval rollback, approver revocation during a model call, suspension without automatic restoration, exact email rendering/escaping, concurrent send decisions, altered hashes, stale or changed draft/case effects, forged recipient/actor overrides, multiple-recipient/header injection, disabled or changed sender configuration, approval audit rollback before the provider request, access loss after the atomic claim, uncertain acceptance after an audit failure, provider rejection, interrupted send recovery and no automatic retry. Migration 0010 preserves existing approved drafts and one-time runs.

The build emits the existing vinext route-classification notice for `/`; it completes successfully. Node emits its experimental-loader notice in the test runner. The intentional synthetic audit failure is an expected rollback test.

## Migration and binding review

Migrations `0007_assistant_action_proposals.sql` and `0008_assistant_agent_runs.sql` are unchanged from the initial local backup. Their SHA-256 hashes are respectively `f6a1b9d1f288fdf13a9f80294874051a2c8973ed9336103a3046dcf766ebe356` and `78beb0ce00131a1e8efc1ecd3620a445d0056bce65cf4c643cdf4d2aff75f573`.

- `0007` introduces the original note-only proposal table. `0009` copies its rows before rebuilding that table with the expanded action allowlist, JSON checks, scope guards and immutability controls. Synthetic migration tests preserve existing proposal IDs and decisions.
- `0008` introduces summary-only investigation rows. `0009` adds approved scheduling, dispatch state, indexes and scope/request guards. It backfills surviving legacy progress/job output into journal snapshots before protecting the journal from updates/deletes. History discarded by the older implementation cannot be recovered.
- `0009` adds version advancement on related operational inserts and a unique follow-up approval index. Native tests apply the full migration chain; Wrangler also applied the pending migration successfully to the separate test database.
- `0010` adds immutable recurring permissions, append-only permission events, per-occurrence uniqueness, exact approved schedule/run associations and immutable email permissions with guarded state transitions. Native tests and Wrangler applied all 23 statements successfully only to isolated local test databases. Existing drafts and one-time requests survived the migration.
- The built `dist/server/wrangler.json` retains `DB` with a migration path resolving to the repository's `drizzle` directory, the `ASSISTANT_WORKFLOW` binding, Workflow name `wht-assistant-investigation`, exported class `AssistantInvestigationWorkflow`, and the `*/5 * * * *` scheduler/recovery trigger. The bundled entry exposes both `fetch` and `scheduled` handlers and the Workflow class. Wrangler's dry run recognises the Workflow binding, a blank email sender and disabled delivery. The dry-run log is `/private/tmp/wht-agentic-dry-run-20261009.log`.
- Configuration remains at compatibility date `2026-08-29` with `nodejs_compat`. Wrangler was updated to 4.149.0, the Cloudflare Vite plugin to its matching 1.63.1 release and Workers types to 5.20261009.1. This removes the older plugin's unsupported generated `legacy_env` field. Native tests use the Miniflare/workerd runtime bundled with the deployment CLI and test the configured date directly. All checks were repeated after aligning the packages; deployed runtime and identity behaviour remain unverified.

## Remaining work and deployment limits

Bulk AI jobs, inbound email processing, delivery-status webhooks and SMS remain outside this implementation. Live email requires a separate verified WHT sender and server-side credential. Full history starts with the new journal; earlier lost details remain unavailable. A live model/email provider and deployed identity proxy have not been exercised by these synthetic tests.

Before any remote migration or deployment, verify the target account/database and migration history, export a backup, and check existing proposal/run JSON for compatibility with `0009` and `0010`'s constraints. Review approved tax rules, retention policy and the trusted identity proxy. Validate the Workflow binding, scheduler/recovery cron and configured compatibility date in an isolated deployed environment with synthetic data and the intended runtime tooling. The deployment script applies remote migrations before uploading the Worker, so invoking it requires that preflight first.

The initial uncommitted diff and untracked files were backed up under `/private/tmp/wht-agentic-initial-20261009*`. Existing local work was extended in place and remains uncommitted.
