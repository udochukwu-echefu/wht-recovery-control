# Real-world MVP implementation map

| Requirement | Implementation | Status |
| --- | --- | --- |
| Demo/live separation | Explicit selector and banner in `app/page.tsx`; live lists replace rather than merge demo data | Implemented |
| Auth, workspaces and RBAC | `lib/auth.ts`, `/api/session`, workspace columns and scoped route predicates | Implemented; production proxy configuration required |
| Workspace settings | `/api/settings` plus live identity, evidence governance, access, AI/security and appearance UI | Implemented; invitations remain intentionally unavailable |
| D1 document storage without R2 | `lib/storage.ts`, `/api/files`, quotas/hash/MIME/signature/retention metadata | Implemented for the 1 MB default |
| Canonical ledger ingestion | Customers, invoices, payments, allocations, source identity and staged import | Implemented |
| WHT applicability review | `/api/applicability`, reviewer note, category and explicit terminal/uncertain outcomes | Implemented; UI workflow still API-led |
| OCR abstraction | `lib/ocr.ts` embedded-text and manual providers | Partial; production OCR provider not configured |
| Receipt extraction and correction | Intake, extracted fields/provenance, reviewer correction, immutable audit checkpoint | Implemented |
| Deterministic receipt matching | `lib/matching.ts`, versioned tolerance and persisted match execution | Implemented |
| Authority evidence/reconciliation | `/api/authority`, authority records/allocations and five deterministic checks | Implemented; external authority API not integrated |
| Recognition/utilisation gates | `/api/review` and `/api/operations` | Implemented |
| Operational case work | Assignment, priority, dates, notes, checklist, correspondence and outcomes | Implemented; API-led controls are not all surfaced in the case UI |
| Server-grounded AI | `/api/assistant` builds facts from scoped D1 records; browser facts ignored | Implemented |
| Durable AI orchestration | Persistent job attempts/leases/idempotency metadata | Partial; queue worker/replay is not implemented |
| Versioned rules | `/api/rules` plus live Rules & controls draft/approval UI and history | Implemented |
| Immutable audit packs | `/api/audit-pack` canonical JSON snapshot with SHA-256 manifest | Implemented; signed PDF not implemented |
| Reporting | `/api/reports` status, ageing, outcomes and activity aggregates | Implemented; dedicated report screens/export UI not implemented |
| Security hardening | Same-origin checks, server actors, tenant filters, rate limits, security headers, audit triggers | Implemented baseline; formal threat model/penetration test outstanding |
| Full E2E automation | Build, pure workflow tests, migration-chain validation, rendered UI tests | Partial; browser-driven persisted happy path remains outstanding |
