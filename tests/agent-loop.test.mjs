import test from "node:test";
import assert from "node:assert/strict";
import { runAgentToolLoop } from "../lib/ai/agent-loop.ts";
import { parsePortfolioToolArguments } from "../lib/ai/agent-tool-contracts.ts";

test("agent chooses multiple tools and carries their results into the next model turn", async () => {
  const replies = [
    { content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "search_cases", arguments: '{"query":"Metro"}' } }] },
    { content: null, tool_calls: [{ id: "call-2", type: "function", function: { name: "get_case_evidence", arguments: '{"caseId":"WHT-1"}' } }] },
    { content: '{"answer":"The receipt is missing.","sourceLabels":["case:WHT-1:evidence"],"limitations":[],"suggestedAction":"Review evidence"}' },
  ];
  const choices = [];
  const observedMessages = [];
  const events = [];
  const result = await runAgentToolLoop({
    messages: [{ role: "system", content: "Test" }, { role: "user", content: "Check Metro evidence" }],
    callModel: async (messages, choice) => {
      choices.push(choice);
      observedMessages.push(structuredClone(messages));
      return replies.shift();
    },
    executeTool: async (name) => name === "search_cases"
      ? { data: { cases: [{ id: "WHT-1" }] }, sourceLabels: ["portfolio.current"], detail: "1 case" }
      : { data: { documents: [] }, sourceLabels: ["case:WHT-1:evidence"], detail: "0 documents" },
    onToolEvent: (event) => events.push(event),
  });
  assert.deepEqual(choices, ["required", "auto", "auto"]);
  assert.equal(observedMessages[1].at(-1).role, "tool");
  assert.equal(observedMessages[2].at(-1).tool_call_id, "call-2");
  assert.deepEqual(result.sourceLabels, ["portfolio.current", "case:WHT-1:evidence"]);
  assert.deepEqual(result.toolTrace.map((item) => item.name), ["search_cases", "get_case_evidence"]);
  assert.deepEqual(events.map((event) => event.state), ["running", "complete", "running", "complete"]);
});

test("agent refuses to answer before inspecting a source and stops at its tool budget", async () => {
  await assert.rejects(runAgentToolLoop({
    messages: [{ role: "user", content: "Question" }],
    callModel: async () => ({ content: "Ungrounded answer" }),
    executeTool: async () => { throw new Error("Should not execute"); },
  }), /did not inspect a source/);
  await assert.rejects(runAgentToolLoop({
    messages: [{ role: "user", content: "Question" }],
    maxToolCalls: 1,
    callModel: async () => ({ content: null, tool_calls: [
      { id: "a", type: "function", function: { name: "search_cases", arguments: "{}" } },
      { id: "b", type: "function", function: { name: "get_case", arguments: '{"caseId":"WHT-1"}' } },
    ] }),
    executeTool: async () => { throw new Error("Should not execute"); },
  }), /tool-call limit/);
});

test("agent tools reject unknown names, extra fields, and malformed case IDs", () => {
  assert.throws(() => parsePortfolioToolArguments("delete_case", "{}"), /unavailable/);
  assert.throws(() => parsePortfolioToolArguments("get_case", '{"caseId":"WHT-1","workspaceId":"other"}'), /unsupported field/);
  assert.throws(() => parsePortfolioToolArguments("get_case", '{"caseId":"../other"}'), /invalid/);
  assert.throws(() => parsePortfolioToolArguments("search_cases", '{"stage":"closed; DROP TABLE recovery_cases"}'), /invalid/);
  assert.deepEqual(parsePortfolioToolArguments("search_cases", '{"query":"Metro%_"}'), { query: "Metro", stage: undefined });
  assert.deepEqual(parsePortfolioToolArguments("propose_case_note", '{"caseId":"WHT-1","note":"  Review the missing receipt with the customer.  "}'), {
    caseId: "WHT-1", note: "Review the missing receipt with the customer.",
  });
  assert.throws(() => parsePortfolioToolArguments("propose_case_note", '{"caseId":"WHT-1","note":"too short"}'), /12 to 700/);
  assert.throws(() => parsePortfolioToolArguments("propose_case_note", '{"caseId":"WHT-1","note":"A sufficient case note.","approved":true}'), /unsupported field/);
});
