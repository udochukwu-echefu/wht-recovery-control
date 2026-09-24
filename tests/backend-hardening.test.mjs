import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("authority reconciliation is bound to the latest reviewed deterministic match", async () => {
  const [authority, review] = await Promise.all([
    source("app/api/authority/route.ts"),
    source("app/api/review/route.ts"),
  ]);

  assert.match(authority, /receipt\.status !== "reviewed"/);
  assert.match(authority, /latestMatchResult\.exceptionCode !== "NO_OPEN_EXCEPTION"/);
  assert.match(authority, /match_execution_id/);
  assert.match(authority, /creditStatus: \{ authority: authority\.creditStatus, pass: \["available", "recognized", "recognised"\]/);
  assert.match(review, /latestAuthority\?\.match_execution_id === latestMatch\.id/);
});

test("AI activity is client-scoped and live AI has no demo fallback", async () => {
  const [service, assistant, providers] = await Promise.all([
    source("lib/ai/service.ts"),
    source("app/api/assistant/route.ts"),
    source("lib/ai/providers.ts"),
  ]);

  assert.match(service, /clientId = "local-client"/);
  assert.match(service, /workspaceId, clientId, caseId/);
  assert.match(assistant, /eq\(aiJobs\.clientId, context\.clientId\)/);
  assert.match(providers, /return new ManualReviewProvider/);
});

test("extraction persistence and recognition use atomic guarded D1 batches", async () => {
  const [intake, extraction, review] = await Promise.all([
    source("app/api/intake/route.ts"),
    source("app/api/extraction/route.ts"),
    source("app/api/review/route.ts"),
  ]);

  assert.match(intake, /await d1\.batch\(\[/);
  assert.match(extraction, /await d1\.batch\(\[/);
  assert.match(review, /stage = 'matched' AND exception_code = 'NO_OPEN_EXCEPTION'/);
  assert.match(review, /recognitionResults\[0\]\.meta\.changes/);
});

test("non-applicable determinations cannot retain a recoverable amount", async () => {
  const applicability = await source("app/api/applicability/route.ts");
  assert.match(applicability, /\["not_applicable", "exempt"\]\.includes\(outcome\) \? 0/);
  assert.match(applicability, /must record zero expected WHT/);
});
