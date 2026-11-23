export type AgentToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: AgentToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type AgentModelReply = { content: string | null; tool_calls?: AgentToolCall[]; responseId?: string };
export type AgentToolOutput = { data: Record<string, unknown>; sourceLabels: string[]; detail: string };
export type AgentTraceEvent = {
  kind: "tool_started" | "tool_completed" | "tool_failed";
  callId: string;
  name: string;
  argumentsJson: string;
  data?: Record<string, unknown>;
  sourceLabels?: string[];
  detail?: string;
};

export async function runAgentToolLoop({
  messages,
  callModel,
  executeTool,
  onToolEvent,
  onTraceEvent,
  maxTurns = 4,
  maxToolCalls = 6,
}: {
  messages: AgentMessage[];
  callModel: (messages: AgentMessage[], toolChoice: "required" | "auto" | "none") => Promise<AgentModelReply>;
  executeTool: (name: string, argumentsJson: string) => Promise<AgentToolOutput>;
  onToolEvent?: (event: { id: string; label: string; state: "running" | "complete"; detail?: string }) => void | Promise<void>;
  onTraceEvent?: (event: AgentTraceEvent) => void | Promise<void>;
  maxTurns?: number;
  maxToolCalls?: number;
}) {
  const transcript = [...messages];
  const sourceLabels = new Set<string>();
  const toolTrace: Array<{ callId: string; name: string; argumentsJson: string; data: Record<string, unknown>; sourceLabels: string[]; detail: string }> = [];
  const callIds = new Set<string>();
  let callCount = 0;
  let responseId: string | undefined;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const choice = turn === 0 ? "required" : turn === maxTurns - 1 ? "none" : "auto";
    const reply = await callModel(transcript, choice);
    responseId = reply.responseId ?? responseId;
    const calls = reply.tool_calls ?? [];
    if (calls.length) {
      if (choice === "none" || callCount + calls.length > maxToolCalls) throw new Error("The assistant reached its tool-call limit.");
      if (calls.some((call) => !call?.id || typeof call.id !== "string" || call.id.length > 100 || call.type !== "function" || !call.function?.name || typeof call.function.name !== "string" || call.function.name.length > 100 || typeof call.function.arguments !== "string" || call.function.arguments.length > 6_000)) throw new Error("The assistant returned an invalid tool call.");
      transcript.push({ role: "assistant", content: reply.content, tool_calls: calls });
      for (const call of calls) {
        if (callIds.has(call.id)) throw new Error("The assistant returned a duplicate tool call ID.");
        callIds.add(call.id);
        callCount += 1;
        const trace = { callId: call.id, name: call.function.name, argumentsJson: call.function.arguments };
        await onTraceEvent?.({ ...trace, kind: "tool_started" });
        await onToolEvent?.({ id: call.id, label: call.function.name, state: "running" });
        let result: AgentToolOutput;
        try { result = await executeTool(call.function.name, call.function.arguments); }
        catch (error) {
          await onTraceEvent?.({ ...trace, kind: "tool_failed", detail: error instanceof Error ? error.message.slice(0, 240) : "Tool failed." });
          throw error;
        }
        const content = JSON.stringify({ data: result.data, sourceLabels: result.sourceLabels });
        if (content.length > 16_000) throw new Error("A tool returned more data than the assistant can safely use.");
        result.sourceLabels.forEach((label) => sourceLabels.add(label));
        toolTrace.push({ ...trace, data: result.data, sourceLabels: result.sourceLabels, detail: result.detail });
        await onTraceEvent?.({ ...trace, kind: "tool_completed", data: result.data, sourceLabels: result.sourceLabels, detail: result.detail });
        transcript.push({ role: "tool", tool_call_id: call.id, content });
        await onToolEvent?.({ id: call.id, label: call.function.name, state: "complete", detail: result.detail });
      }
      continue;
    }
    if (choice === "required") throw new Error("The assistant did not inspect a source before answering.");
    if (!reply.content?.trim()) throw new Error("The assistant returned no answer.");
    return { content: reply.content, sourceLabels: [...sourceLabels], toolTrace, responseId };
  }
  throw new Error("The assistant reached its step limit before answering.");
}
