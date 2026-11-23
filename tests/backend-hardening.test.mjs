import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

  // A default tenant would silently file jobs from a forgetful caller under a fake workspace.
  assert.doesNotMatch(service, /\b(workspaceId|clientId)\s*=\s*["'`]/);
  assert.match(service, /workspaceId, clientId, caseId/);
  assert.match(assistant, /eq\(aiJobs\.clientId, context\.clientId\)/);
  assert.match(providers, /return new ManualReviewProvider/);
});

test("every AI task records the authenticated workspace and client", async () => {
  const runtimeFiles = (await Promise.all(["app", "lib", "worker"].map(async (directory) =>
    (await readdir(new URL(`../${directory}/`, import.meta.url), { recursive: true }))
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => `${directory}/${file}`)))).flat();
  const calls = [];
  for (const path of runtimeFiles) {
    const text = await source(path);
    for (const match of text.matchAll(/\brunAiTask\s*(<[^(]*>)?\s*\(/g)) {
      if (/function\s+$/.test(text.slice(Math.max(0, match.index - 12), match.index))) continue;
      let depth = 0;
      let end = match.index + match[0].length - 1;
      for (; end < text.length; end += 1) {
        if (text[end] === "(") depth += 1;
        else if (text[end] === ")" && --depth === 0) break;
      }
      calls.push({ path, call: text.slice(match.index, end + 1) });
    }
  }
  assert.ok(calls.length > 0, "expected at least one runAiTask call");
  for (const { path, call } of calls) {
    assert.match(call, /workspaceId: context\.workspace\.id/, `${path} must record the authenticated workspace`);
    assert.match(call, /clientId: context\.clientId/, `${path} must record the active client`);
  }
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
