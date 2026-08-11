# WHT Recovery Control Workspace

A practitioner-supervised presentation pilot for detecting, explaining, and resolving Nigerian withholding-tax receivable exceptions.

The pilot includes a synthetic portfolio plus a real vertical slice: staged ledger mapping, durable source-file storage, document classification, source-grounded receipt extraction, reviewer-confirmed candidate matching, deterministic controls, recovery planning, grounded communication drafts, a constrained case copilot, evidence reports, and append-only audit history. It does not provide tax advice, send messages, recognise or utilise credits autonomously, or submit information to any tax authority.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Local D1 data is stored under `.wrangler/state`.

## AI provider modes and demo fallback

`AI_PROVIDER=auto` uses the managed DeepSeek provider when `DEEPSEEK_API_KEY` is present and otherwise selects the deterministic presentation fixtures. Use `AI_PROVIDER=demo` for a reliable offline rehearsal, `AI_PROVIDER=manual` to exercise human-only fallback paths, or `AI_PROVIDER=deepseek` to require the managed provider. Provider/model details are confined to AI activity and audit details.

The pilot does not include production OCR. Originals up to 1 MB are retained in D1; when no machine-readable text is available the workflow clearly enters manual-entry/OCR fallback instead of failing silently.

AI is deliberately assistive:

1. AI tasks return strict, allowlisted structures with confidence, exact source snippets, page references, prompt version and source references.
2. Application logic calculates amounts, detects duplicates, computes candidate factors and runs rule set `2026.07` comparisons.
3. A reviewer confirms mappings, candidate links, receipt corrections, plans, communication use and consequential case decisions.
4. AI cannot send messages, alter amounts or tax rules, recognise/utilise/close/write off a case, or submit to an authority.

## Operator journey

1. Open **Data intake**, upload a ledger CSV, inspect the preview and confirm every proposed mapping.
2. Run deterministic validation. Candidate cases are created only after the reviewer selects **Create candidate cases**.
3. Attach or paste receipt text. Review classification, duplicate position, all 12 extracted fields and their provenance.
4. Select a ranked candidate and add the required reviewer note. Deterministic matching runs only after this confirmation.
5. Open the case, review/correct permitted extraction fields with an audit note, and rerun the controls.
6. Review a recovery plan, grounded evidence-request draft or case-copilot answer. These suggestions do not change the case.
7. Use **AI activity** to inspect task status, source references, confidence, latency, validation outcome and provider governance details.

Sample inputs are in `tests/fixtures/`.

## Ledger mapping contract

The reviewer must map `customer_name`, `invoice_reference`, `invoice_gross_amount`, `payment_net_amount`, `payment_date`, and `reporting_period`. `expected_wht_amount`, when supplied, must equal the deterministic invoice-gross/payment-net gap. Invalid/negative amounts, net values above gross, duplicates and existing cases block import.

## Product boundaries

- Presentation pilot only; not production ready
- Use synthetic or appropriately redacted data
- Deterministic matching before AI assistance
- Human approval for consequential actions
- Tax rules and administrative procedures are versioned configuration
- Pilot originals, structured cases, provenance, and audit events in D1
- Authentication/tenant isolation, production OCR, background orchestration, authority integrations, delivery integrations, production monitoring and formal Nigerian tax/legal validation remain outstanding
