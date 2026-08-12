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
    readFile(new URL("../drizzle/0002_audit_immutability.sql", import.meta.url), "utf8"),
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

test("theme choice persists and application dropdowns use the custom listbox", async () => {
  const [page, layout, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /wht-theme/);
  assert.match(layout, /prefers-color-scheme: light/);
  assert.match(page, /role="combobox"/);
  assert.match(page, /role="listbox"/);
  assert.match(page, /Toggle light or dark mode/);
  assert.doesNotMatch(page, /<select\b/i);
  assert.match(styles, /:root\[data-theme="light"\]/);
  assert.match(styles, /\.custom-select-menu/);
});

test("settings are workspace-scoped, role-aware and auditable", async () => {
  const [page, route, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Workspace and client/);
  assert.match(page, /Evidence governance/);
  assert.match(page, /Access and roles/);
  assert.match(page, /AI and security/);
  assert.match(page, /Open live settings/);
  assert.doesNotMatch(page, /<select\b/i);
  assert.match(route, /requireContext\(request/);
  assert.match(route, /context\.workspace\.id/);
  assert.match(route, /WORKSPACE_SETTINGS_CHANGED/);
  assert.match(route, /EVIDENCE_GOVERNANCE_CHANGED/);
  assert.match(route, /MEMBER_ROLE_CHANGED/);
  assert.match(route, /You cannot remove your own administrator access/);
  assert.match(styles, /\.settings-layout/);
  assert.match(styles, /\.settings-member-table/);
});

test("case copilot sends the reviewer question through the secured server-grounded route", async () => {
  const [page, assistantRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/assistant/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /question: action === "copilot" \? copilotQuestion\.trim\(\) : undefined/);
  assert.match(page, /What evidence is missing\?/);
  assert.match(page, /Why is recognition blocked\?/);
  assert.match(page, /What should I do next\?/);
  assert.match(page, /aria-label="Example case questions"/);
  assert.match(page, /aria-label="Case copilot answer"/);
  assert.match(page, /Grounded in connected case records/);
  assert.match(page, /Recommended next step/);
  assert.match(page, /Evidence used/);
  assert.match(page, /Scope and limitations/);
  assert.doesNotMatch(page, /facts: action === "copilot"/);
  assert.match(assistantRoute, /task === "case_copilot" && !question/);
  assert.match(assistantRoute, /latestDeterministicMatch/);
  assert.match(assistantRoute, /authorityReconciliation/);
});

test("demo and live records have an explicit non-merging boundary", async () => {
  const [page, casesRoute, assistantRoute, auth] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cases/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/assistant/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /synthetic records are isolated from the live workspace/i);
  assert.match(page, /setCases\(persisted\)/);
  assert.doesNotMatch(page, /\[\.\.\.persisted, \.\.\.current\.filter/);
  assert.doesNotMatch(page, /storedStage === "recognised" \|\| storedStage === "closed"/);
  assert.match(casesRoute, /recoveryCases\.workspaceId/);
  assert.match(assistantRoute, /sourceGroundedOnServer: true/);
  assert.doesNotMatch(assistantRoute, /body\.facts/);
  assert.match(auth, /oai-authenticated-user-id/);
  assert.match(auth, /localDevelopment/);
});

test("demo AI interactions stay local and never require a production session", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /<AiActivityView key=\{appMode\} mode=\{appMode\}/);
  assert.match(page, /function demoAiActivityJobs/);
  assert.match(page, /if \(mode === "demo"\) \{\s*setJobs\(demoAiActivityJobs\(\)\)/);
  assert.match(page, /<PortfolioBriefingPanel mode=\{mode\}/);
  assert.match(page, /Synthetic guidance only/);
  assert.match(page, /No live records or external authority data were queried/);
});
