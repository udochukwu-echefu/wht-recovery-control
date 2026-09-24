/** Shared by deterministic validation, AI mapping contracts and the intake UI. */
export const ledgerTargetFields = [
  "customer_name",
  "customer_tin",
  "invoice_reference",
  "invoice_gross_amount",
  "payment_net_amount",
  "payment_date",
  "reporting_period",
  "expected_wht_amount",
  "currency",
  "entity_reference",
  "unmapped",
] as const;

export type LedgerTargetField = (typeof ledgerTargetFields)[number];
