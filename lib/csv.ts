export type LedgerRow = {
  customer: string;
  customerTin: string;
  invoiceReference: string;
  invoiceGrossKobo: number;
  paymentNetKobo: number;
  expectedWhtKobo: number;
  reportingPeriod: string;
};

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

function parseCsvRows(input: string): string[][] {
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

function moneyToKobo(value: string) {
  const normalized = value.replace(/[₦,\s]/g, "").replace(/^NGN/i, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
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
