# WHT Recovery Control

An evidence-led Nigerian withholding-tax recovery workspace for practitioner-supervised case detection, receipt review, authority reconciliation, recognition and utilisation control.

The application has two explicit data modes:

- **Demo** contains synthetic walkthrough records. Browser changes are temporary and never claim to be audited.
- **Live** contains only authenticated, workspace-scoped D1 records. Demo and live cases are never merged.

## Local setup

Requirements: Node.js 22.13+ and a Cloudflare account only when using remote resources.

```bash
npm install
npm run db:migrate:local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), switch to **Live**, then create and approve a rule set under **Rules & controls** before importing a ledger. Local D1 data is kept under `.wrangler/state`.

If upgrading a database created by the pre-migration runtime bootstrap, verify the old tables first and record migrations `0000`–`0003` in `d1_migrations`; do not delete the database merely to make migration tracking pass. Migration `0004_real_world_mvp.sql` is additive.

## Configuration

Copy `.env.example` to `.env` for local development. Secrets stay server-side.

```dotenv
DEEPSEEK_API_KEY=your-secret
DEEPSEEK_MODEL=deepseek-v4-flash
AI_PROVIDER=auto
```

`AI_PROVIDER=auto` uses DeepSeek when configured and otherwise uses deterministic fixtures. `demo` forces fixtures; `manual` forces the reviewed manual fallback; `deepseek` requires the managed provider. Provider/model details appear only in AI activity and audit details.

Production identity is derived from trusted `oai-authenticated-user-*` proxy headers. Production requests without an identity fail closed. Localhost receives an isolated local-development account so the live workflow can be tested without an identity proxy.

## Controlled workflow

1. Create and practitioner-approve an effective-dated rule set.
2. Upload a ledger CSV; confirm every mapping and pass deterministic validation.
3. Import canonical customers, invoices, payments and allocations. Each payment gap starts in applicability review—not as an assumed tax receivable.
4. Confirm WHT applicability with category, rate/amount and a required note, or record exemption/non-applicability.
5. Upload a receipt original. D1 storage enforces workspace quota, per-file size, SHA-256 duplicate detection, MIME/extension/signature checks and retention metadata.
6. Review source-grounded extraction fields and provenance. Permitted corrections require a note; the audit event and match execution are written before state changes.
7. Confirm a candidate and run deterministic receipt matching under the active approved rule version.
8. Import/review authority records and reconcile beneficiary TIN, deductor TIN, period, amount tolerance and credit status.
9. Recognise only after applicability, extraction review, receipt matching and authority reconciliation all pass.
10. Record utilisation, write-off or non-recoverable outcomes through role-controlled operations. Utilisation requires evidence.
11. Export an immutable, hash-addressed JSON audit pack or query portfolio/ageing/outcome reports.

## Data and security model

- Workspaces, users, memberships and roles (`admin`, `practitioner`, `reviewer`, `analyst`, `read_only`)
- Workspace and client scope on operational rows and every API query
- Server-derived actors for audit events; browser-supplied actor/role/workspace values are ignored
- Append-only audit table protected by update/delete triggers
- Same-origin mutation checks and D1-backed rate limits on intake and assistant routes
- Authenticated document download; administrator-only soft deletion
- A live Settings workspace for client identity, evidence limits, retention, member roles, AI availability and appearance; every material settings change is role-controlled and audited
- D1 BLOB adapter (`put`, `get`, metadata/hash verification, soft delete) with 1 MB default file and 25 MB default workspace quotas
- Security headers and no-store API responses at the Worker boundary
- No autonomous tax conclusion, authority submission, outbound message, recognition, utilisation, closure or write-off

## AI and OCR boundaries

AI inputs are assembled from workspace-scoped server records. Browser case narratives and amounts are not accepted as ground truth. AI output remains allowlisted, source-labelled and advisory; deterministic rules own calculated outcomes.

The OCR abstraction currently supports embedded/reviewer-supplied text and an explicit manual-review fallback. A production image/PDF OCR provider is not configured. The original document remains retained and the UI reports that manual entry is required.

AI jobs persist status, prompt version, input hash, attempts, retry/lease metadata, validation result, latency and reviewer corrections. Calls currently execute synchronously in the request; a production queue/consumer for crash-safe deferred execution remains required before high-volume use.

## Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run db:migrate:local
npm run db:migrate:remote
```

Do not apply remote migrations or deploy without reviewing the target account, approved rules, identity-proxy configuration, retention policy and a database backup/export.

## Current limitations

- No direct tax-authority integration or filing submission
- No production OCR provider
- No outbound email/SMS delivery; drafts are reviewed and external correspondence is recorded manually
- No background queue consumer yet; persisted AI jobs are request-executed
- Audit packs are canonical JSON, not signed PDF bundles
- Tax rates and procedures require Nigerian practitioner validation before approval

Sample inputs are in `tests/fixtures/`. The practitioner brief used to shape the control boundaries is external reference material and is not bundled into the application.
