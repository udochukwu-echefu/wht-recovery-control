import type { AiProvider, AiTaskDefinition } from "./contracts.ts";

type DeepSeekResponse = { id?: unknown; error?: { message?: unknown }; choices?: Array<{ message?: { content?: unknown } }> };

export class DemoAiProvider implements AiProvider {
  readonly name = "deterministic-demo";
  readonly model = "wht-pilot-fixtures-v1";

  async generateStructured<TInput, TOutput>(task: AiTaskDefinition<TInput, TOutput>, input: TInput) {
    return { output: task.demoOutput(input), responseId: `demo-${crypto.randomUUID()}` };
  }
}

export class ManualReviewProvider implements AiProvider {
  readonly name = "manual";
  readonly model = "unconfigured";

  async generateStructured(): Promise<{ output: unknown }> {
    throw Object.assign(new Error("AI assistance is unavailable. Continue with the manual review path."), { code: "AI_MANUAL_REVIEW" });
  }
}

export class DeepSeekAiProvider implements AiProvider {
  readonly name = "deepseek";
  readonly model: string;
  private readonly apiKey: string;

  constructor({ apiKey, model }: { apiKey: string; model: string }) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateStructured<TInput, TOutput>(task: AiTaskDefinition<TInput, TOutput>, input: TInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18_000);
    try {
      const outputContract = task.demoOutput(input);
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 3_500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: task.systemPrompt },
            { role: "user", content: JSON.stringify({ task: task.type, promptVersion: task.promptVersion, instruction: "Return one JSON object with exactly the same keys, nesting and value types as outputContract. Do not add, rename or omit fields. Base every factual value on input; outputContract defines structure and allowed value shape only.", input, outputContract }) },
          ],
        }),
      });
      const body = await response.json() as DeepSeekResponse;
      if (!response.ok) throw Object.assign(new Error("The configured AI provider could not complete this task."), { code: `PROVIDER_${response.status}` });
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw Object.assign(new Error("The configured AI provider returned no structured result."), { code: "PROVIDER_EMPTY_OUTPUT" });
      return { output: JSON.parse(content) as unknown, responseId: typeof body.id === "string" ? body.id : undefined };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw Object.assign(new Error("AI assistance timed out. Continue with manual review or retry."), { code: "PROVIDER_TIMEOUT" });
      if (error instanceof SyntaxError) throw Object.assign(new Error("The AI result failed structured-output validation. Continue with manual review."), { code: "INVALID_AI_JSON" });
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function selectAiProvider({ mode, apiKey, model }: { mode: string; apiKey: string; model: string }): AiProvider {
  if (mode === "manual") return new ManualReviewProvider();
  if (mode === "deepseek" && apiKey) return new DeepSeekAiProvider({ apiKey, model });
  if (mode === "deepseek" && !apiKey) return new ManualReviewProvider();
  if (mode === "demo") return new DemoAiProvider();
  return apiKey ? new DeepSeekAiProvider({ apiKey, model }) : new DemoAiProvider();
}
