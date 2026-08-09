# Product

## Register

product

## Users

Nigerian finance teams, tax managers, accountants, and tax-practice reviewers who reconcile withholding-tax receivables across invoices, payments, deduction receipts, and tax-authority records. They work in evidence-heavy operational workflows and need to decide what is valid, what is missing, and who must act next.

## Product Purpose

Turn fragmented WHT records into an explainable recovery queue. The MVP should detect likely deductions, connect each case to its evidence, expose mismatches without overstating recoverability, coordinate human-approved follow-up, and track cases through recognition and closure. Success means a reviewer can understand and advance a case in minutes, with every conclusion traceable to a source.

## Implemented vertical slice

```text
CSV ledger -> validate/map -> D1 recovery cases
Receipt PDF/image -> R2 original -> OpenAI structured extraction
                                      |
                                      v
                         deterministic rule set 2026.07
                                      |
                                      v
                         exception + evidence provenance
                                      |
                                      v
                         reviewer decision -> D1 audit event
```

AI does not decide recoverability. It converts an unstructured receipt into six typed facts with source snippets and confidence. Matching, exception codes, status transitions, and audit records are application logic.

Current MVP gaps are authentication/tenant isolation, direct-to-R2 multipart upload for larger files, authority-system integration, background job orchestration, editable field-level corrections, rules administration, notifications, and production monitoring.

## Brand Personality

Assured, forensic, calm. The product should feel like a dependable finance operations instrument: precise enough for practitioners, clear enough for business users, and restrained around uncertain claims.

## Anti-references

Avoid generic fintech dashboards, navy-and-gold tax branding, decorative AI imagery, oversized vanity metrics, alarmist recovery claims, opaque confidence scores, dense legacy accounting software, and autonomous actions that imply legal or tax judgment.

## Design Principles

1. Evidence before assertion: every amount and status should lead back to a source.
2. Explain the exception: show matched fields, failed fields, and the next practical action.
3. Keep humans accountable: consequential messages and status changes require explicit review.
4. Make uncertainty visible: partial matches and unresolved cases are first-class states.
5. Optimize for recovery work: prioritise value, age, owner, and next action over decorative analytics.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Never rely on colour alone for status, preserve keyboard navigation and visible focus, respect reduced-motion preferences, use readable financial-number formatting, and keep dense tables usable on smaller screens through structural responsive layouts.
