# Product

## Register

product

## Users

Nigerian finance teams, tax managers, accountants, and tax-practice reviewers who reconcile withholding-tax receivables across invoices, payments, deduction receipts, and tax-authority records. They work in evidence-heavy operational workflows and need to decide what is valid, what is missing, and who must act next.

## Product Purpose

Turn fragmented WHT records into an explainable recovery queue. The MVP should detect likely deductions, connect each case to its evidence, expose mismatches without overstating recoverability, coordinate human-approved follow-up, and track cases through recognition and closure. Success means a reviewer can understand and advance a case in minutes, with every conclusion traceable to a source.

## Implemented supervised pilot

```text
ledger -> preview -> AI mapping suggestion -> reviewer confirmation
       -> deterministic validation -> candidate cases

receipt -> pilot original in D1 -> classification + duplicate check
        -> 12 source-grounded fields -> application-owned candidate factors
        -> AI ranking -> reviewer link confirmation
        -> deterministic rule set 2026.07 -> exception + explanation
        -> reviewer field correction -> immutable audit checkpoint

case facts -> reviewable plan / grounded draft / constrained copilot
           -> printable evidence report / portfolio briefing / AI activity
```

AI does not decide recoverability. Provider outputs pass strict task-specific validation and retain prompt version, source references, latency and safe error categories. Amounts, matching, exception codes, status gates and audit records remain application logic or qualified-human decisions.

This remains a controlled pilot rather than an unattended production tax system. Authentication, workspace/client isolation, governed rules and D1-only evidence storage are implemented. Remaining work includes signed identity-assertion verification at the Worker boundary, production OCR for scans/image-only PDFs, background job orchestration, authority-system integration, external delivery controls, production observability, automated retention enforcement, penetration testing, and practitioner/legal validation of Nigerian WHT content and procedures.

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
