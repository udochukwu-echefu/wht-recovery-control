import assert from "node:assert/strict";
import test from "node:test";
import {
  moneyToKobo,
  parseCsvRows,
  parseLedgerCsvWithMapping,
  validateLedgerMapping,
} from "../lib/csv.ts";

const headers = [
  "Customer",
  "Invoice",
  "Gross",
  "Net",
  "Paid",
  "Period",
  "WHT",
];
const targets = [
  "customer_name",
  "invoice_reference",
  "invoice_gross_amount",
  "payment_net_amount",
  "payment_date",
  "reporting_period",
  "expected_wht_amount",
];
const mappings = headers.map((sourceColumn, index) => ({
  sourceColumn,
  targetField: targets[index],
}));
const validRow = [
  "Acme",
  "INV-1",
  "1000",
  "950",
  "2026-07-03",
  "Jul 2026",
  "50",
];
const parse = (row) =>
  parseLedgerCsvWithMapping(`${headers.join(",")}\n${row.join(",")}`, mappings);

test("decimal currency conversion preserves kobo without binary rounding", () => {
  assert.equal(moneyToKobo("1.13"), 113);
  assert.equal(moneyToKobo("NGN 1,234.56"), 123456);
  assert.equal(moneyToKobo("₦0.01"), 1);
  assert.equal(moneyToKobo("0"), 0);
  assert.equal(moneyToKobo("-1.13"), -113);
  for (const value of [
    "",
    " ",
    "₦",
    "NGN",
    "0x10",
    "1e3",
    "1,2,3",
    "1 000",
    "12.345",
    "Infinity",
    "9007199254740991",
  ]) {
    assert.ok(
      Number.isNaN(moneyToKobo(value)),
      `Must reject ${JSON.stringify(value)}`,
    );
  }
});

test("blank payments and malformed supplied WHT cannot create recovery candidates", () => {
  for (const [column, value] of [
    [3, ""],
    [2, ""],
    [6, "invalid"],
    [6, "NGN"],
  ]) {
    const row = [...validRow];
    row[column] = value;
    const result = parse(row);
    assert.equal(result.rows.length, 0);
    assert.ok(result.errors.length > 0);
  }
});

test("an omitted optional WHT amount still uses the deterministic payment gap", () => {
  const row = [...validRow];
  row[6] = "";
  const result = parse(row);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].expectedWhtKobo, 5000);
});

test("source mappings must be one-to-one even when every target appears", () => {
  const duplicate = mappings.map((mapping) => ({ ...mapping }));
  duplicate[3].sourceColumn = "Gross";
  assert.equal(validateLedgerMapping(headers, duplicate).valid, false);
  assert.equal(
    validateLedgerMapping([...headers, "Customer"], mappings).valid,
    false,
  );
  assert.equal(validateLedgerMapping([...headers, ""], mappings).valid, false);
});

test("extra and missing CSV cells are rejected instead of silently discarded", () => {
  for (const row of [validRow.slice(0, -1), [...validRow, "unexpected"]]) {
    const result = parse(row);
    assert.equal(result.rows.length, 0);
    assert.match(result.errors.join(" "), /number of values/);
  }
});

test("oversized ledgers cannot pass validation with silently omitted rows", () => {
  const rows = Array.from({ length: 251 }, (_, index) =>
    ["Acme", `INV-${index}`, ...validRow.slice(2)].join(","),
  );
  const result = parseLedgerCsvWithMapping(
    [headers.join(","), ...rows].join("\n"),
    mappings,
  );
  assert.match(result.errors.join(" "), /at most 250/);
});

test("quoted CSV cells retain commas, escaped quotes and embedded newlines", () => {
  assert.deepEqual(
    parseCsvRows('Name,Value\r\n"Acme, Ltd","A ""quote""\nnext line"'),
    [
      ["Name", "Value"],
      ["Acme, Ltd", 'A "quote"\nnext line'],
    ],
  );
});
