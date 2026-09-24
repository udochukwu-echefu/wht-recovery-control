import test from "node:test";
import assert from "node:assert/strict";
import { consumeChatStream } from "../lib/ai/chat-stream.ts";

function responseFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { "content-type": "application/x-ndjson" } });
}

test("chat stream parses split events and completes only after done", async () => {
  const events = [];
  const stream = responseFromChunks([
    '{"type":"status","phase":"thinking","label":"Loading",',
    '"extra":true}\n{"type":"answer_start"}\n{"type":"answer_delta","text":"Hello"}\n',
    '{"type":"done","metadata":{},"conversationTitle":"Test"}\n',
  ]);
  await consumeChatStream(stream, (event) => events.push(event));
  assert.deepEqual(events.map((event) => event.type), ["status", "answer_start", "answer_delta", "done"]);
  assert.equal(events[2].text, "Hello");
});

test("chat stream surfaces a server error and rejects incomplete replies", async () => {
  await assert.rejects(consumeChatStream(responseFromChunks(['{"type":"error","message":"Manual review required"}\n']), () => {}), /Manual review required/);
  await assert.rejects(consumeChatStream(responseFromChunks(['{"type":"answer_delta","text":"Partial"}\n']), () => {}), /before completion/);
});
