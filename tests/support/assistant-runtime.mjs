import { createRequire } from "node:module";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumeChatStream } from "../../lib/ai/chat-stream.ts";

// Use the runtime and bundler pinned by the deployment CLI, rather than the older
// runtime bundled by Vite's Cloudflare plugin. esbuild is not a direct
// dependency of this project, so it is resolved through Wrangler as well.
const require = createRequire(import.meta.url);
const requireFromWrangler = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions, Response: RuntimeResponse, FormData: RuntimeFormData } = requireFromWrangler("miniflare");
const { build } = requireFromWrangler("esbuild");

let bundle;
export const call = (name, args, id = `call-${crypto.randomUUID()}`) => ({ content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
export const answer = (labels = ["case:CASE-A"]) => ({ content: JSON.stringify({ answer: "The recorded case still needs a receipt. A practitioner should review the evidence.", sourceLabels: labels, limitations: [], suggestedAction: "Review the receipt evidence." }) });
export const emailResponse = (status, payload) => RuntimeResponse.json(payload, {status});

export async function runtime(t, { stopBeforeMigration = null, emailEnabled = false } = {}) {
  if (!bundle) bundle = (await build({ entryPoints: [fileURLToPath(new URL("assistant-worker.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers"], tsconfig: fileURLToPath(new URL("../../tsconfig.json", import.meta.url)) })).outputFiles[0].text;
  const directory = await mkdtemp(join(tmpdir(), "wht-assistant-test-"));
  const requests = [];
  const emailRequests = [];
  let replies = [];
  let emailReplies = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle, compatibilityDate: "2026-08-29", compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "synthetic-assistant-db" }, d1Persist: join(directory, "d1"), workflowsPersist: join(directory, "workflows"),
    workflows: { ASSISTANT_WORKFLOW: { name: "synthetic-assistant-workflow", className: "AssistantInvestigationWorkflow" } },
    bindings: { AI_PROVIDER: "deepseek", DEEPSEEK_MODEL: "synthetic-model", DEEPSEEK_API_KEY: "synthetic-test-key", RESEND_API_KEY: "re_synthetic_test_key", EMAIL_DELIVERY_ENABLED: emailEnabled ? "true" : "false", EMAIL_FROM: "recovery@sender.example.invalid" },
    outboundService: async (request) => {
      if (request.url === "https://api.resend.com/emails") {
        const input = await request.json();emailRequests.push({payload:input,idempotencyKey:request.headers.get("idempotency-key")});
        const configured = emailReplies.shift();
        return typeof configured === "function" ? configured(input) : configured ?? RuntimeResponse.json({id:`synthetic-email-${emailRequests.length}`});
      }
      if (request.url !== "https://api.deepseek.com/chat/completions") throw new Error(`Unexpected external request: ${request.url}`);
      const input = await request.json(); requests.push(input);
      let reply = replies.shift();
      if (typeof reply === "function") reply = await reply(input);
      if (!reply) return RuntimeResponse.json({ error: "No synthetic reply configured" }, { status: 503 });
      return RuntimeResponse.json({ id: `synthetic-response-${requests.length}`, choices: [{ finish_reason: reply.tool_calls ? "tool_calls" : "stop", message: reply }] });
    },
  }));
  t.after(async () => { await mf.dispose(); await rm(directory, { recursive: true, force: true }); });
  const db = await mf.getD1Database("DB");
  const migrations = (await readdir(new URL("../../drizzle/", import.meta.url))).filter((name) => name.endsWith(".sql")).sort();
  const apply = async (name) => {
    const migration = await readFile(new URL(`../../drizzle/${name}`, import.meta.url), "utf8");
    // D1 exec is line oriented; use the migration's explicit statement boundaries.
    for (const statement of migration.split("--> statement-breakpoint")) if (statement.trim()) await db.prepare(statement.trim()).run();
  };
  for (const name of migrations) { if (name === stopBeforeMigration) break; await apply(name); }
  await db.batch([
    db.prepare("INSERT INTO workspaces (id,name,slug,mode) VALUES ('ws-a','Synthetic workspace A','synthetic-a','live'),('ws-b','Synthetic workspace B','synthetic-b','live')"),
    db.prepare("INSERT INTO clients (id,workspace_id,name,legal_name,entity_type,jurisdiction,tin,status) VALUES ('client-a','ws-a','Synthetic A','Synthetic A','company','federal','TEST-A','active'),('client-other','ws-a','Other client','Other client','company','federal','TEST-OTHER','active'),('client-b','ws-b','Synthetic B','Synthetic B','company','federal','TEST-B','active')"),
    db.prepare("INSERT INTO workspace_settings (workspace_id,default_client_id) VALUES ('ws-a','client-a'),('ws-b','client-b')"),
    db.prepare("INSERT INTO users (id,provider_subject,email,display_name,status) VALUES ('owner','synthetic-owner','owner@example.invalid','Synthetic Owner','active'),('reviewer','synthetic-reviewer','reviewer@example.invalid','Synthetic Reviewer','active'),('analyst','synthetic-analyst','analyst@example.invalid','Synthetic Analyst','active'),('reader','synthetic-reader','reader@example.invalid','Synthetic Reader','active'),('outsider','synthetic-outsider','outsider@example.invalid','Synthetic Outsider','active')"),
    db.prepare("INSERT INTO workspace_memberships (id,workspace_id,user_id,role,status) VALUES ('m-owner','ws-a','owner','practitioner','active'),('m-reviewer','ws-a','reviewer','reviewer','active'),('m-analyst','ws-a','analyst','analyst','active'),('m-reader','ws-a','reader','read_only','active'),('m-outsider','ws-b','outsider','admin','active')"),
    db.prepare("INSERT INTO recovery_cases (id,workspace_id,client_id,customer,invoice_reference,invoice_gross_kobo,payment_net_kobo,expected_wht_kobo,stage,exception_code,updated_at) VALUES ('CASE-A','ws-a','client-a','Synthetic Acme','SYNTH-1',10000000,9500000,500000,'evidence-needed','RECEIPT_MISSING',?),('CASE-OTHER','ws-a','client-other','PRIVATE OTHER CLIENT','SYNTH-2',20000000,19000000,1000000,'evidence-needed','RECEIPT_MISSING',?),('CASE-B','ws-b','client-b','PRIVATE OTHER WORKSPACE','SYNTH-3',30000000,28500000,1500000,'evidence-needed','RECEIPT_MISSING',?)").bind(new Date().toISOString(), new Date().toISOString(), new Date().toISOString()),
    db.prepare("INSERT INTO assistant_conversations (id,workspace_id,client_id,user_id,title) VALUES ('conv-owner','ws-a','client-a','owner','Synthetic owner conversation'),('conv-analyst','ws-a','client-a','analyst','Synthetic analyst conversation'),('conv-outsider','ws-b','client-b','outsider','Synthetic outsider conversation')"),
  ]);
  const fetch = (path, { actor = "owner", method = "GET", body, headers = {} } = {}) => mf.dispatchFetch(`https://protected.example${path}`, {
    method, headers: { "oai-authenticated-user-id": `synthetic-${actor}`, "x-wht-workspace": actor === "outsider" ? "ws-b" : "ws-a", ...(body && !(body instanceof RuntimeFormData) ? { "content-type": "application/json" } : {}), ...headers },
    ...(body ? { body: body instanceof RuntimeFormData ? body : JSON.stringify(body) } : {}),
  });
  const propose = async (actionType, payload, { caseId = "CASE-A", conversationId = "conv-owner", userId = "owner" } = {}) => {
    const id = crypto.randomUUID();
    const item = await db.prepare("SELECT workspace_id, client_id, updated_at, customer FROM recovery_cases WHERE id = ?").bind(caseId).first();
    await db.prepare("INSERT INTO assistant_action_proposals (id,workspace_id,client_id,conversation_id,ai_job_id,case_id,case_updated_at,action_type,payload_json,source_labels_json,proposed_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,item.workspace_id,item.client_id,conversationId,id,caseId,item.updated_at,actionType,JSON.stringify({ ...payload, customer: item.customer }),JSON.stringify([`case:${caseId}`]),userId).run();
    return (await (await fetch(`/api/assistant/proposals?id=${id}`, { actor: "reviewer" })).json()).proposals[0];
  };
  const review = (proposal, decision = "approve", overrides = {}) => fetch("/api/assistant/proposals", { actor: "reviewer", method: "POST", body: { proposalId: proposal.id, previewHash: proposal.previewHash, decision, note: "Reviewed exact synthetic effects.", ...overrides } });
  const chat = async (question, actor = "owner") => {
    const form = new RuntimeFormData(); form.set("conversationId", `conv-${actor}`); form.set("question", question);
    const events = [];
    await consumeChatStream(await fetch("/api/assistant/chat", { actor, method: "POST", body: form }), (event) => events.push(event));
    return events;
  };
  const waitRun = async (id, expected = ["completed", "failed", "canceled"]) => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const run = await db.prepare("SELECT * FROM assistant_agent_runs WHERE id = ?").bind(id).first();
      if (expected.includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Synthetic run ${id} did not reach ${expected.join(", ")}`);
  };
  return { mf, db, requests, emailRequests, fetch, propose, review, chat, waitRun, apply, replies: (values) => { replies = [...values]; }, emailReplies: (values) => {emailReplies=[...values];} };
}
