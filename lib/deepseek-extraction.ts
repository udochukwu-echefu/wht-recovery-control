import type { ReceiptExtraction } from "./matching";

type DeepSeekResponse = {
  id?: unknown;
  error?: { message?: unknown };
  choices?: Array<{
    message?: {
      tool_calls?: Array<{ function?: { name?: unknown; arguments?: unknown } }>;
    };
  }>;
};

const fieldNames = ["customer_name", "beneficiary_tin", "invoice_reference", "receipt_number", "wht_amount", "reporting_period"] as const;

const fieldSchema = {
  type: "object",
  properties: {
    value: { type: "string" },
    confidence: { type: "integer" },
    evidence_quote: { type: "string" },
    page_number: { anyOf: [{ type: "integer" }, { type: "null" }] },
  },
  required: ["value", "confidence", "evidence_quote", "page_number"],
  additionalProperties: false,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolArguments(response: DeepSeekResponse) {
  const call = response.choices?.[0]?.message?.tool_calls?.find((item) => item.function?.name === "extract_wht_receipt");
  const args = call?.function?.arguments;
  if (typeof args !== "string" || !args.trim()) throw new Error("DeepSeek returned no structured receipt extraction.");
  const parsed: unknown = JSON.parse(args);
  if (!isRecord(parsed)) throw new Error("DeepSeek extraction did not return an object.");
  return parsed;
}

export async function extractReceiptText({
  documentText,
  apiKey,
  model,
}: {
  documentText: string;
  apiKey: string;
  model: string;
}): Promise<{ extraction: ReceiptExtraction; responseId: string; model: string }> {
  const text = documentText.trim().slice(0, 50_000);
  if (text.length < 20) throw new Error("Receipt text is too short to extract reliably.");
  const properties = Object.fromEntries(fieldNames.map((name) => [name, fieldSchema]));
  const response = await fetch("https://api.deepseek.com/beta/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      thinking: { type: "disabled" },
      max_tokens: 2_000,
      messages: [
        {
          role: "system",
          content: "You extract facts from Nigerian withholding-tax receipts. Never infer a missing identifier, amount, or reporting period. Use an empty string for missing text. Return amount digits in naira without commas or a currency symbol. Evidence quotes must be short exact snippets from the supplied text.",
        },
        { role: "user", content: `Extract this WHT receipt text:\n\n${text}` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "extract_wht_receipt",
          description: "Return the source-grounded WHT receipt fields.",
          strict: true,
          parameters: { type: "object", properties, required: fieldNames, additionalProperties: false },
        },
      }],
      tool_choice: { type: "function", function: { name: "extract_wht_receipt" } },
    }),
  });
  const body = await response.json() as DeepSeekResponse;
  if (!response.ok) {
    const message = body.error && typeof body.error.message === "string" ? body.error.message : `DeepSeek request failed with status ${response.status}.`;
    throw new Error(message);
  }

  const parsed = parseToolArguments(body);
  const readField = (name: typeof fieldNames[number]) => {
    const field = parsed[name];
    if (!isRecord(field)) throw new Error(`DeepSeek extraction omitted ${name}.`);
    return {
      value: typeof field.value === "string" ? field.value.trim() : "",
      confidence: typeof field.confidence === "number" ? Math.max(0, Math.min(100, Math.round(field.confidence))) : 0,
      evidenceQuote: typeof field.evidence_quote === "string" ? field.evidence_quote.trim() : "",
      pageNumber: typeof field.page_number === "number" ? Math.round(field.page_number) : null,
    };
  };
  const values = Object.fromEntries(fieldNames.map((name) => [name, readField(name)]));
  const amountText = values.wht_amount.value.replace(/[^0-9.]/g, "");
  const amount = amountText ? Number(amountText) : Number.NaN;

  return {
    responseId: typeof body.id === "string" ? body.id : "",
    model,
    extraction: {
      customerName: values.customer_name.value,
      beneficiaryTin: values.beneficiary_tin.value,
      invoiceReference: values.invoice_reference.value,
      receiptNumber: values.receipt_number.value,
      whtAmountKobo: Number.isFinite(amount) ? Math.round(amount * 100) : null,
      reportingPeriod: values.reporting_period.value,
      fields: Object.fromEntries(fieldNames.map((name) => [name, { confidence: values[name].confidence, evidenceQuote: values[name].evidenceQuote, pageNumber: values[name].pageNumber }])),
    },
  };
}
