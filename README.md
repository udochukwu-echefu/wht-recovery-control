# WHT Recovery Control Workspace

A portfolio MVP for detecting, explaining, and resolving Nigerian withholding-tax receivable exceptions.

The MVP includes a synthetic portfolio plus a real vertical slice: durable CSV and receipt intake, source-file storage, AI-assisted receipt extraction, deterministic matching, reviewer decisions, and an immutable-style audit history. It does not provide tax advice or submit information to any tax authority.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Local D1 and R2 data are stored under `.wrangler/state`.

## Enable AI receipt extraction

Copy `.env.example` to `.env` and set `OPENAI_API_KEY`. The default multimodal model is `gpt-5.6`; override `OPENAI_MODEL` if needed. Without a key, receipt originals are still saved and clearly marked `ai_configuration_required`.

AI is deliberately assistive:

1. It extracts receipt fields, confidence, exact source snippets, and page numbers into a strict JSON schema.
2. Rule set `2026.07` compares invoice reference, beneficiary TIN, amount, and reporting period.
3. A reviewer must recognise or close a case. AI cannot send messages, alter tax rules, or submit to an authority.

## CSV contract

Required columns: `customer`, `invoice_reference`, `invoice_gross`, and `payment_net`. Optional columns include `customer_tin`, `expected_wht`, and `reporting_period`. Common aliases such as `invoice_no`, `gross_amount`, and `amount_paid` are accepted.

## Product boundaries

- Use synthetic or appropriately redacted data in the portfolio deployment
- Deterministic matching before AI assistance
- Human approval for consequential actions
- Tax rules and administrative procedures are versioned configuration
- Originals in R2; structured cases, provenance, and audit events in D1
