export type ChatStreamEvent =
  | { type: "status"; phase: string; label: string }
  | { type: "tool"; id: string; label: string; state: "running" | "complete"; detail?: string }
  | { type: "answer_start" }
  | { type: "answer_delta"; text: string }
  | { type: "done"; metadata: Record<string, unknown>; conversationTitle: string }
  | { type: "error"; message: string };

export async function consumeChatStream(response: Response, onEvent: (event: ChatStreamEvent) => void) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || "The assistant could not start this request.");
  }
  if (!response.body) throw new Error("The assistant response stream is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const receiveLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ChatStreamEvent;
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "done") completed = true;
    onEvent(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 100_000) throw new Error("The assistant response exceeded the stream limit.");
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        receiveLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) receiveLine(buffer);
    if (!completed) throw new Error("The assistant response ended before completion. Please retry.");
  } finally {
    reader.releaseLock();
  }
}
