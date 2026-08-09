import type { ReceiptExtraction } from "./matching";

type OpenAIResponse = {
  id?: unknown;
  error?: { message?: unknown };
  output?: Array<{ type?: unknown; content?: Array<{ type?: unknown; text?: unknown; refusal?: unknown }> }>;
};

const fieldNames = ["customer_name", "beneficiary_tin", "invoice_reference", "receipt_number", "wht_amount", "reporting_period"] as const;

const fieldSchema = {
  type: "object",
  properties: {
    value: { type: "string" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    evidence_quote: { type: "string" },
    page_number: { type: ["integer", "null"] },
  },
  required: ["value", "confidence", "evidence_quote", "page_number"],
  additionalProperties: false,
} as const;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function outputText(response: OpenAIResponse) {
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" && typeof content.refusal === "string") throw new Error(`AI extraction refused: ${content.refusal}`);
      if (content.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new Error("AI extraction returned no structured output.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function extractReceipt({
  file,
  apiKey,
  model,
}: {
  file: File;
  apiKey: string;
  model: string;
}): Promise<{ extraction: ReceiptExtraction; responseId: string; model: string }> {
  const bytes = await file.arrayBuffer();
  const fileData = `data:${file.type};base64,${arrayBufferToBase64(bytes)}`;
  const documentInput = file.type.startsWith("image/")
    ? { type: "input_image", image_url: fileData, detail: "high" }
    : { type: "input_file", filename: file.name, file_data: fileData, detail: "high" };
  const properties = Object.fromEntries(fieldNames.map((name) => [name, fieldSchema]));
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      store: false,
      input: [{
        role: "user",
        content: [
          documentInput,
          { type: "input_text", text: "Extract facts from this Nigerian withholding-tax receipt. Do not infer missing identifiers or amounts. Return empty strings for missing text fields. Amount must be digits only in naira, without commas or a currency symbol. Evidence quotes must be short exact snippets from the document." },
        ],
      }],
      text: { format: { type: "json_schema", name: "wht_receipt", strict: true, schema: { type: "object", properties, required: fieldNames, additionalProperties: false } } },
    }),
  });
  const body = await response.json() as OpenAIResponse;
  if (!response.ok) {
    const message = body.error && typeof body.error.message === "string" ? body.error.message : `OpenAI request failed with status ${response.status}.`;
    throw new Error(message);
  }

  const parsed: unknown = JSON.parse(outputText(body));
  if (!isRecord(parsed)) throw new Error("AI extraction did not return an object.");
  const readField = (name: typeof fieldNames[number]) => {
    const field = parsed[name];
    if (!isRecord(field)) throw new Error(`AI extraction omitted ${name}.`);
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
