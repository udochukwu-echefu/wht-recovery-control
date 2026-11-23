import test from "node:test";
import assert from "node:assert/strict";
import { runtime, call, answer } from "./support/assistant-runtime.mjs";
import { dispatchAssistantRun, recoverUndispatchedRuns } from "../lib/ai/agent-runs.ts";

async function start(app) {
  const response = await app.fetch("/api/assistant/runs", { method: "POST", body: { conversationId: "conv-owner", question: "Investigate the recorded receipt evidence for Synthetic Acme." } });
  assert.equal(response.status, 202, await response.clone().text());
  return (await response.json()).runId;
}
const detail = async (app, id, actor = "reviewer") => (await app.fetch(`/api/assistant/runs?id=${id}`, { actor })).json();

test("a Workflow finishes after disconnect and reviewers inspect full cross-user history without duplicating replayed work", async (t) => {
  const app = await runtime(t);
  const before = await app.db.prepare("SELECT * FROM recovery_cases WHERE id = 'CASE-A'").first();
  app.replies([call("search_cases", { query: "Synthetic Acme" }), call("get_case_evidence", { caseId: "CASE-A" }), answer(["case:CASE-A:evidence"])]);
  const id = await start(app);
  await app.waitRun(id, ["completed"]);
  const saved = await detail(app, id);
  assert.equal(saved.run.status, "completed");
  const tools = saved.events.filter((event) => event.eventType === "tool_completed");
  assert.equal(tools.length, 2);
  assert.equal(JSON.parse(tools[0].payload.argumentsJson).query, "Synthetic Acme");
  assert.equal(tools[0].payload.data.cases[0].id, "CASE-A");
  assert.deepEqual(tools[1].payload.sourceLabels, ["case:CASE-A:evidence"]);
  assert.ok(saved.events.some((event) => event.eventType === "completed"));
  assert.equal((await app.fetch(`/api/assistant/runs?id=${id}`, { actor: "analyst" })).status, 404);
  assert.equal((await app.fetch(`/api/assistant/runs?id=${id}`, { actor: "outsider" })).status, 404);
  const conversation = await (await app.fetch("/api/assistant/conversations?id=conv-owner")).json();
  assert.equal(conversation.messages.at(-1).metadata.backgroundRun.status, "completed");
  assert.match(conversation.messages.at(-1).content, /practitioner/);
  const countBefore = app.requests.length;
  assert.equal((await app.fetch("/__test/restart", { method: "POST", body: { runId: id } })).status, 200);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const status = await (await app.fetch(`/__test/workflow-status?id=${id}`)).json();
    if (status.status === "complete") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(app.requests.length, countBefore);
  assert.equal((await app.db.prepare("SELECT count(*) AS n FROM audit_events WHERE event_type = 'AI_PORTFOLIO_AGENT_GENERATED'").first()).n, 1);
  assert.deepEqual(await app.db.prepare("SELECT * FROM recovery_cases WHERE id = 'CASE-A'").first(), before);
});

test("approved scheduled follow-up sleeps, inspects only its case and retains findings for reconnect", async (t) => {
  const app = await runtime(t);
  const proposal = await app.propose("schedule_followup", { runAt: new Date(Date.now() + 1_500).toISOString(), question: "Inspect whether receipt evidence is now available." });
  app.replies([call("get_case", { caseId: "CASE-A" }), call("get_case_evidence", { caseId: "CASE-A" }), answer(["case:CASE-A:evidence"])]);
  assert.equal((await app.review(proposal)).status, 200);
  assert.equal(app.requests.length, 0);
  await app.waitRun(proposal.id, ["completed"]);
  assert.ok(app.requests.every((request) => request.tools.every((tool) => ["get_case", "get_case_evidence", "get_case_checks"].includes(tool.function.name))));
  const history = await detail(app, proposal.id);
  assert.equal(history.run.approvalProposalId, proposal.id);
  assert.equal(history.events[0].eventType, "scheduled");
  assert.equal(history.events.filter((event) => event.eventType === "tool_completed").length, 2);
  const conversation = await (await app.fetch("/api/assistant/conversations?id=conv-owner")).json();
  assert.equal(conversation.messages.at(-1).metadata.backgroundRun.status, "completed");
  assert.equal((await app.db.prepare("SELECT count(*) AS n FROM correspondence_events").first()).n, 0);
  assert.equal((await app.db.prepare("SELECT count(*) AS n FROM case_outcomes").first()).n, 0);
});

test("scheduled investigations reject other cases and cannot prepare action proposals", async (t) => {
  const app = await runtime(t);
  const proposal = await app.propose("schedule_followup", { runAt: new Date(Date.now() + 500).toISOString(), question: "Inspect this case only." });
  app.replies([call("get_case", { caseId: "CASE-OTHER" }), call("propose_case_note", { caseId: "CASE-A", note: "A background action that must never be prepared." })]);
  assert.equal((await app.review(proposal)).status, 200);
  await app.waitRun(proposal.id, ["failed"]);
  const saved = await detail(app, proposal.id);
  assert.equal(saved.events.filter((event) => event.eventType === "tool_failed").length, 2);
  assert.doesNotMatch(JSON.stringify(app.requests), /PRIVATE OTHER CLIENT/);
  assert.equal((await app.db.prepare("SELECT count(*) AS n FROM assistant_action_proposals").first()).n, 1);
  assert.equal((await app.db.prepare("SELECT count(*) AS n FROM case_notes").first()).n, 0);
});

for (const revoke of ["membership", "user", "client", "case"]) {
  test(`scheduled wake rechecks ${revoke} access before reading records`, async (t) => {
    const app = await runtime(t);
    const proposal = await app.propose("schedule_followup", { runAt: new Date(Date.now() + 1_000).toISOString(), question: "Inspect this case's current evidence." });
    assert.equal((await app.review(proposal)).status, 200);
    const updates = {
      membership: "UPDATE workspace_memberships SET status = 'revoked' WHERE user_id = 'owner'",
      user: "UPDATE users SET status = 'disabled' WHERE id = 'owner'",
      client: "UPDATE clients SET status = 'inactive' WHERE id = 'client-a'",
      case: "UPDATE recovery_cases SET deleted_at = '2026-10-09T00:00:00.000Z' WHERE id = 'CASE-A'",
    };
    await app.db.prepare(updates[revoke]).run();
    await app.waitRun(proposal.id, ["failed"]);
    assert.equal(app.requests.length, 0);
    assert.equal((await app.db.prepare("SELECT count(*) AS n FROM case_notes").first()).n, 0);
  });
}

test("cancellation preserves history, stops a sleeping follow-up and prevents publication", async (t) => {
  const app = await runtime(t);
  const proposal = await app.propose("schedule_followup", { runAt: new Date(Date.now() + 2_500).toISOString(), question: "Inspect the case after the scheduled time." });
  assert.equal((await app.review(proposal)).status, 200);
  assert.equal((await app.fetch("/api/assistant/runs", { actor: "analyst", method: "DELETE", body: { runId: proposal.id } })).status, 404);
  assert.equal((await app.fetch("/api/assistant/runs", { actor: "reviewer", method: "DELETE", body: { runId: proposal.id } })).status, 200);
  assert.equal((await app.fetch("/api/assistant/runs", { actor: "reviewer", method: "DELETE", body: { runId: proposal.id } })).status, 409);
  await new Promise((resolve) => setTimeout(resolve, 2_800));
  assert.equal(app.requests.length, 0);
  const saved = await detail(app, proposal.id);
  assert.equal(saved.run.status, "canceled");
  assert.ok(saved.events.some((event) => event.eventType === "scheduled"));
  assert.ok(saved.events.some((event) => event.eventType === "canceled"));
  const conversation = await (await app.fetch("/api/assistant/conversations?id=conv-owner")).json();
  assert.ok(conversation.messages.at(-1).metadata.activity.length > 0);
  assert.equal(conversation.messages.at(-1).metadata.backgroundRun.status, "canceled");
});

test("a failed model attempt retries once and both attempts remain reviewable", async (t) => {
  const app = await runtime(t);
  app.replies([call("get_case", { caseId: "CASE-A" }, "same-call"), { content: "invalid JSON" }, call("get_case", { caseId: "CASE-A" }, "same-call"), answer()]);
  const id = await start(app);
  await app.waitRun(id, ["completed"]);
  const saved = await detail(app, id);
  assert.deepEqual(saved.events.filter((event) => event.eventType === "attempt_started").map((event) => event.attempt), [1, 2]);
  assert.equal(saved.events.filter((event) => event.eventType === "attempt_failed").length, 1);
  assert.deepEqual(saved.events.filter((event) => event.eventType === "tool_completed").map((event) => event.attempt), [1, 2]);
  assert.equal((await app.db.prepare("SELECT attempt_count FROM ai_jobs WHERE id = ?").bind(id).first()).attempt_count, 2);
  assert.equal((await app.db.prepare("SELECT count(*) AS n FROM case_notes").first()).n, 0);
});

test("the dispatch outbox recovers an uncertain create using the same instance and caps unavailable starts", async (t) => {
  const app = await runtime(t);
  const proposal = await app.propose("schedule_followup", { runAt: new Date(Date.now() + 86_400_000).toISOString(), question: "Inspect this approved case later." });
  assert.equal((await app.review(proposal)).status, 200);
  await app.db.prepare("UPDATE assistant_agent_runs SET dispatched_at = NULL, dispatch_attempts = 0 WHERE id = ?").bind(proposal.id).run();
  let creates = 0;
  const binding = { create: async ({ id }) => { creates++; assert.equal(id, proposal.id); throw new Error("Synthetic lost create response"); }, get: async (id) => { assert.equal(id, proposal.id); return { status: async () => ({ status: "running" }) }; } };
  await dispatchAssistantRun({ DB: app.db, ASSISTANT_WORKFLOW: binding }, proposal.id);
  await recoverUndispatchedRuns({ DB: app.db, ASSISTANT_WORKFLOW: binding });
  assert.equal(creates, 1);
  assert.ok((await app.db.prepare("SELECT dispatched_at FROM assistant_agent_runs WHERE id = ?").bind(proposal.id).first()).dispatched_at);
  await app.db.prepare("UPDATE assistant_agent_runs SET dispatched_at = NULL, dispatch_attempts = 0 WHERE id = ?").bind(proposal.id).run();
  const unavailable = { create: async () => { throw new Error("Synthetic unavailable binding"); }, get: async () => { throw new Error("Synthetic missing instance"); } };
  for (let attempt = 0; attempt < 4; attempt++) await dispatchAssistantRun({ DB: app.db, ASSISTANT_WORKFLOW: unavailable }, proposal.id);
  const run = await app.db.prepare("SELECT status, dispatch_attempts FROM assistant_agent_runs WHERE id = ?").bind(proposal.id).first();
  assert.deepEqual(run, { status: "failed", dispatch_attempts: 3 });
  assert.equal((await detail(app, proposal.id)).events.filter((event) => event.eventType === "dispatch_failed").length, 3);
});

test("a process lost after reserving its last dispatch attempt cannot leave a run queued forever", async (t) => {
  const app = await runtime(t);
  const first = await app.propose("schedule_followup", { runAt: new Date(Date.now() + 86_400_000).toISOString(), question: "Inspect approved evidence later." });
  assert.equal((await app.review(first)).status, 200);
  await app.db.prepare("UPDATE assistant_agent_runs SET dispatched_at = NULL, dispatch_attempts = 3 WHERE id = ?").bind(first.id).run();
  await recoverUndispatchedRuns({ DB: app.db, ASSISTANT_WORKFLOW: { get: async () => ({ status: async () => ({ status: "running" }) }) } });
  assert.ok((await app.db.prepare("SELECT dispatched_at FROM assistant_agent_runs WHERE id = ?").bind(first.id).first()).dispatched_at);
  const second = await app.propose("schedule_followup", { runAt: new Date(Date.now() + 86_400_000).toISOString(), question: "Another approved inspection." });
  assert.equal((await app.review(second)).status, 200);
  await app.db.prepare("UPDATE assistant_agent_runs SET dispatched_at = NULL, dispatch_attempts = 3 WHERE id = ?").bind(second.id).run();
  await recoverUndispatchedRuns({ DB: app.db, ASSISTANT_WORKFLOW: { get: async () => { throw new Error("Synthetic missing instance"); } } });
  assert.equal((await app.db.prepare("SELECT status FROM assistant_agent_runs WHERE id = ?").bind(second.id).first()).status, "failed");
});

test("cancellation during a model request prevents subsequent reads and response publication", async (t) => {
  const app = await runtime(t);
  let release;
  const pendingReply = new Promise((resolve) => { release = resolve; });
  app.replies([async () => pendingReply, answer()]);
  const id = await start(app);
  const deadline = Date.now() + 5_000;
  while (!app.requests.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(app.requests.length, 1);
  assert.equal((await app.fetch("/api/assistant/runs", { actor: "reviewer", method: "DELETE", body: { runId: id } })).status, 200);
  release(call("get_case", { caseId: "CASE-A" }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const saved = await detail(app, id);
  assert.equal(saved.run.status, "canceled");
  assert.equal(saved.events.filter((event) => event.eventType === "tool_completed").length, 0);
  assert.equal(saved.events.filter((event) => event.eventType === "completed").length, 0);
  assert.equal(app.requests.length, 1);
  assert.equal((await app.db.prepare("SELECT content FROM assistant_messages WHERE id = ?").bind(saved.run.assistantMessageId).first()).content, "");
});
