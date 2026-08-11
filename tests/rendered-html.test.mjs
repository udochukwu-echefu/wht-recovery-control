import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the WHT recovery workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>WHT Recovery Control Workspace<\/title>/i);
  assert.match(html, /Recovery overview/i);
  assert.match(html, /Needs intervention/i);
  assert.match(html, /Priority recovery queue/i);
  assert.match(html, /Alpha Energy/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("starter preview is removed and product metadata is present", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Recovery overview/);
  assert.match(page, /Human approval required/);
  assert.doesNotMatch(page, /Turn evidence gaps into next actions\./);
  assert.doesNotMatch(page, /Bring the source records together\./);
  assert.match(layout, /WHT Recovery Control Workspace/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});

test("AI provider abstraction keeps a deterministic demo and manual fallback", async () => {
  const [providers, contracts, environment] = await Promise.all([
    readFile(new URL("../lib/ai/providers.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/contracts.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(providers, /DemoAiProvider/);
  assert.match(providers, /ManualReviewProvider/);
  assert.match(providers, /DeepSeekAiProvider/);
  assert.match(contracts, /candidate_ranking/);
  assert.match(contracts, /case_copilot/);
  assert.match(environment, /DEEPSEEK_MODEL=deepseek-v4-flash/);
  assert.match(environment, /AI_PROVIDER=auto/);
});

test("reviewer corrections are audited before recognition", async () => {
  const [page, reviewRoute, schemaEnsure, matching] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/review/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/ensure.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/matching.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Review extracted receipt/);
  assert.match(page, /Required before recognition/);
  assert.match(reviewRoute, /EXTRACTION_REVIEW_COMPLETED/);
  assert.match(reviewRoute, /Add a review note of at least 10 characters/);
  assert.match(reviewRoute, /Recognition is blocked until deterministic matching has no open exception/);
  assert.match(reviewRoute, /Recognition is blocked until an authority record is connected and verified/);
  assert.match(schemaEnsure, /audit_events_no_update/);
  assert.match(schemaEnsure, /audit_events_no_delete/);
  assert.match(matching, /INVOICE_MISMATCH/);
});
