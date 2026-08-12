export type OcrRequest = { documentId: string; fileName: string; mimeType: string; suppliedText?: string };
export type OcrResult = { status: "completed" | "manual_required"; text: string; provider: string; pageCount: number | null; warnings: string[] };

export interface OcrProvider {
  readonly name: string;
  extract(request: OcrRequest): Promise<OcrResult>;
}

export class EmbeddedTextOcrProvider implements OcrProvider {
  readonly name = "embedded-text";
  async extract(request: OcrRequest): Promise<OcrResult> {
    const text = request.suppliedText?.trim() ?? "";
    return text
      ? { status: "completed", text, provider: this.name, pageCount: null, warnings: [] }
      : { status: "manual_required", text: "", provider: this.name, pageCount: null, warnings: ["No machine-readable text was supplied"] };
  }
}

export class ManualOcrProvider implements OcrProvider {
  readonly name = "manual-review";
  async extract(): Promise<OcrResult> {
    return { status: "manual_required", text: "", provider: this.name, pageCount: null, warnings: ["Enter verified source text or configure an OCR provider"] };
  }
}

export async function extractDocumentText(request: OcrRequest) {
  const provider: OcrProvider = request.suppliedText?.trim() ? new EmbeddedTextOcrProvider() : new ManualOcrProvider();
  return provider.extract(request);
}
