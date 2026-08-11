export type LedgerRow = {
  customer: string;
  customerTin: string;
  invoiceReference: string;
  invoiceGrossKobo: number;
  paymentNetKobo: number;
  expectedWhtKobo: number;
  reportingPeriod: string;
};

export type CanonicalLedgerField = "customer_name" | "customer_tin" | "invoice_reference" | "invoice_gross_amount" | "payment_net_amount" | "payment_date" | "reporting_period" | "expected_wht_amount" | "currency" | "entity_reference" | "unmapped";
export type ConfirmedMapping = { sourceColumn: string; targetField: CanonicalLedgerField };
export type ValidatedLedgerRow = LedgerRow & { sourceRow: number; paymentDate: string; currency: string; entityReference: string; sourceIdentity: string };

const aliases = {
  customer: ["customer", "customer_name", "payer", "client"],
  customerTin: ["customer_tin", "tin", "payer_tin"],
  invoiceReference: ["invoice_reference", "invoice_ref", "invoice_no", "invoice_number", "invoice"],
  invoiceGross: ["invoice_gross", "gross_amount", "invoice_amount", "gross"],
  paymentNet: ["payment_net", "net_payment", "amount_paid", "payment_amount", "net_amount"],
  expectedWht: ["expected_wht", "wht_amount", "withholding_tax"],
  reportingPeriod: ["reporting_period", "period", "wht_period"],
} as const;

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field.trim());
      field = "";
    } else if (character === "\n") {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function columnIndex(headers: string[], names: readonly string[]) {
  return headers.findIndex((header) => names.includes(header));
}

export function moneyToKobo(value: string) {
  const normalized = value.replace(/[₦,\s]/g, "").replace(/^NGN/i, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

function detectedType(values: string[]) {
  const populated = values.filter(Boolean);
  if (!populated.length) return "empty";
  if (populated.every((value) => Number.isFinite(moneyToKobo(value)))) return "amount";
  if (populated.every((value) => /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value))) return "date";
  if (populated.every((value) => /^[\d-]{8,20}$/.test(value))) return "identifier";
  return "text";
}

export function previewLedgerCsv(input: string, limit = 15) {
  const rows = parseCsvRows(input);
  if (rows.length < 2) throw new Error("CSV must contain a header and at least one data row.");
  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error("Every CSV column must have a heading.");
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicates.length) throw new Error(`Duplicate CSV headings are not allowed: ${[...new Set(duplicates)].join(", ")}.`);
  const dataRows = rows.slice(1, 251);
  const preview = dataRows.slice(0, limit).map((values, index) => ({
    __row: index + 2,
    ...Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""])),
  }));
  const detectedTypes = Object.fromEntries(headers.map((header, column) => [header, detectedType(dataRows.slice(0, 20).map((row) => row[column] ?? ""))]));
  return { headers, preview, detectedTypes, rowCount: dataRows.length, truncated: rows.length > 251 };
}

export function validateLedgerMapping(headers: string[], mappings: ConfirmedMapping[]) {
  const allowed = new Set<CanonicalLedgerField>(["customer_name", "customer_tin", "invoice_reference", "invoice_gross_amount", "payment_net_amount", "payment_date", "reporting_period", "expected_wht_amount", "currency", "entity_reference", "unmapped"]);
  const errors: string[] = [];
  if (mappings.length !== headers.length) errors.push("Every source column needs an explicit mapping or Unmapped selection.");
  if (mappings.some((mapping) => !headers.includes(mapping.sourceColumn))) errors.push("A mapping refers to a source column that is not in this ledger.");
  if (mappings.some((mapping) => !allowed.has(mapping.targetField))) errors.push("A mapping refers to a target field that is not allowed.");
  const selected = mappings.filter((mapping) => mapping.targetField !== "unmapped").map((mapping) => mapping.targetField);
  const duplicateTargets = selected.filter((field, index) => selected.indexOf(field) !== index);
  if (duplicateTargets.length) errors.push(`Each canonical field can be mapped once: ${[...new Set(duplicateTargets)].join(", ")}.`);
  const required: CanonicalLedgerField[] = ["customer_name", "invoice_reference", "invoice_gross_amount", "payment_net_amount", "payment_date", "reporting_period"];
  const missing = required.filter((field) => !selected.includes(field));
  if (missing.length) errors.push(`Missing mandatory mappings: ${missing.join(", ")}.`);
  return { valid: errors.length === 0, errors, missingFields: missing };
}

export function parseLedgerCsvWithMapping(input: string, mappings: ConfirmedMapping[]): { rows: ValidatedLedgerRow[]; errors: string[]; warnings: string[]; duplicateSourceIdentities: string[] } {
  const parsed = parseCsvRows(input);
  if (parsed.length < 2) return { rows: [], errors: ["CSV must contain a header and at least one data row."], warnings: [], duplicateSourceIdentities: [] };
  const headers = parsed[0].map((header) => header.trim());
  const mappingValidation = validateLedgerMapping(headers, mappings);
  if (!mappingValidation.valid) return { rows: [], errors: mappingValidation.errors, warnings: [], duplicateSourceIdentities: [] };
  const indexByTarget = Object.fromEntries(mappings.filter((mapping) => mapping.targetField !== "unmapped").map((mapping) => [mapping.targetField, headers.indexOf(mapping.sourceColumn)])) as Record<CanonicalLedgerField, number>;
  const rows: ValidatedLedgerRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const identities = new Set<string>();
  const duplicateSourceIdentities = new Set<string>();
  for (const [offset, values] of parsed.slice(1, 251).entries()) {
    const sourceRow = offset + 2;
    const read = (field: CanonicalLedgerField) => indexByTarget[field] >= 0 ? values[indexByTarget[field]]?.trim() ?? "" : "";
    const customer = read("customer_name");
    const invoiceReference = read("invoice_reference");
    const gross = moneyToKobo(read("invoice_gross_amount"));
    const net = moneyToKobo(read("payment_net_amount"));
    const explicitText = read("expected_wht_amount");
    const explicitWht = explicitText ? moneyToKobo(explicitText) : Number.NaN;
    const deterministicGap = gross - net;
    const expectedWhtKobo = Number.isFinite(explicitWht) ? explicitWht : deterministicGap;
    const paymentDate = read("payment_date");
    const reportingPeriod = read("reporting_period");
    const sourceIdentity = `${customer.toLowerCase().replace(/[^a-z0-9]/g, "")}:${invoiceReference.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    if (!customer || !invoiceReference || !paymentDate || !reportingPeriod) errors.push(`Row ${sourceRow}: customer, invoice reference, payment date and reporting period are required.`);
    if (!Number.isFinite(gross) || !Number.isFinite(net)) errors.push(`Row ${sourceRow}: gross and payment amounts must be valid numbers.`);
    if (Number.isFinite(gross) && Number.isFinite(net) && (gross < 0 || net < 0 || net > gross)) errors.push(`Row ${sourceRow}: negative values and payments above invoice gross are not allowed.`);
    if (!Number.isFinite(expectedWhtKobo) || expectedWhtKobo <= 0) errors.push(`Row ${sourceRow}: the deterministic WHT gap must be positive.`);
    if (Number.isFinite(explicitWht) && Number.isFinite(deterministicGap) && Math.abs(explicitWht - deterministicGap) > 100) errors.push(`Row ${sourceRow}: supplied expected WHT does not equal the deterministic payment gap.`);
    if (identities.has(sourceIdentity)) duplicateSourceIdentities.add(sourceIdentity); else identities.add(sourceIdentity);
    if (errors.some((error) => error.startsWith(`Row ${sourceRow}:`))) continue;
    rows.push({ customer, customerTin: read("customer_tin"), invoiceReference, invoiceGrossKobo: gross, paymentNetKobo: net, expectedWhtKobo, reportingPeriod, sourceRow, paymentDate, currency: read("currency") || "NGN", entityReference: read("entity_reference"), sourceIdentity });
  }
  if (duplicateSourceIdentities.size) errors.push("Duplicate customer and invoice combinations must be resolved before import.");
  if (parsed.length > 251) warnings.push("Only the first 250 data rows are available in this presentation pilot.");
  return { rows, errors, warnings, duplicateSourceIdentities: [...duplicateSourceIdentities] };
}

export function parseLedgerCsv(input: string): { rows: LedgerRow[]; errors: string[] } {
  const parsed = parseCsvRows(input);
  if (parsed.length < 2) return { rows: [], errors: ["CSV must contain a header and at least one data row."] };

  const headers = parsed[0].map(normalizeHeader);
  const indexes = {
    customer: columnIndex(headers, aliases.customer),
    customerTin: columnIndex(headers, aliases.customerTin),
    invoiceReference: columnIndex(headers, aliases.invoiceReference),
    invoiceGross: columnIndex(headers, aliases.invoiceGross),
    paymentNet: columnIndex(headers, aliases.paymentNet),
    expectedWht: columnIndex(headers, aliases.expectedWht),
    reportingPeriod: columnIndex(headers, aliases.reportingPeriod),
  };

  const missing = [
    ["customer", indexes.customer],
    ["invoice_reference", indexes.invoiceReference],
    ["invoice_gross", indexes.invoiceGross],
    ["payment_net", indexes.paymentNet],
  ].filter(([, index]) => index === -1).map(([name]) => name);
  if (missing.length) return { rows: [], errors: [`Missing required columns: ${missing.join(", ")}.`] };

  const rows: LedgerRow[] = [];
  const errors: string[] = [];
  for (const [offset, values] of parsed.slice(1, 251).entries()) {
    const rowNumber = offset + 2;
    const gross = moneyToKobo(values[indexes.invoiceGross] ?? "");
    const net = moneyToKobo(values[indexes.paymentNet] ?? "");
    const explicitWht = indexes.expectedWht >= 0 ? moneyToKobo(values[indexes.expectedWht] ?? "") : Number.NaN;
    const expected = Number.isFinite(explicitWht) ? explicitWht : gross - net;
    const customer = values[indexes.customer]?.trim() ?? "";
    const invoiceReference = values[indexes.invoiceReference]?.trim() ?? "";

    if (!customer || !invoiceReference || !Number.isFinite(gross) || !Number.isFinite(net) || expected <= 0) {
      errors.push(`Row ${rowNumber}: customer, invoice reference, gross, net, and a positive WHT gap are required.`);
      continue;
    }

    rows.push({
      customer,
      customerTin: indexes.customerTin >= 0 ? values[indexes.customerTin]?.trim() ?? "" : "",
      invoiceReference,
      invoiceGrossKobo: gross,
      paymentNetKobo: net,
      expectedWhtKobo: expected,
      reportingPeriod: indexes.reportingPeriod >= 0 ? values[indexes.reportingPeriod]?.trim() ?? "" : "",
    });
  }
  if (parsed.length > 251) errors.push("Only the first 250 data rows were imported in this MVP.");
  return { rows, errors };
}
