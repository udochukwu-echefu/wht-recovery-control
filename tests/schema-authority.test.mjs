import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("versioned migrations are the only runtime schema authority", async () => {
  const [packageJson, routeSources] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    Promise.all([
      "app/api/cases/route.ts",
      "app/api/intake/route.ts",
      "app/api/review/route.ts",
      "app/api/audit/route.ts",
      "lib/ai/service.ts",
    ].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8"))),
  ]);
  const scripts = JSON.parse(packageJson).scripts;

  assert.match(scripts.deploy, /npm run build && npm run db:migrate:remote && wrangler deploy/);
  assert.match(scripts["db:migrate:remote"], /d1 migrations apply DB --remote/);
  assert.match(scripts["db:migrate:test"], /d1 migrations apply DB --local/);
  for (const source of routeSources) {
    assert.doesNotMatch(source, /ensureSchema|CREATE TABLE|ALTER TABLE/);
  }
  await assert.rejects(access(new URL("../db/ensure.ts", import.meta.url)));
});

test("hardening migration enforces business uniqueness and immutable control history", async () => {
  const migration = await readFile(new URL("../drizzle/0005_zero_cost_hardening.sql", import.meta.url), "utf8");

  for (const indexName of [
    "uq_extracted_fields_workspace_document_field",
    "uq_ledger_imports_workspace_client_hash",
    "uq_candidate_matches_workspace_document_case",
    "uq_memberships_workspace_user",
    "uq_invoices_workspace_client_source",
    "uq_receipts_workspace_document",
    "uq_authority_workspace_client_identity",
    "uq_authority_successful_receipt",
    "uq_rule_sets_workspace_version_global",
    "uq_case_outcomes_workspace_case",
  ]) assert.match(migration, new RegExp(indexName));

  assert.match(migration, /authority_allocations_balance_guard/);
  assert.match(migration, /recovery_case_stage_guard/);
  assert.match(migration, /ADD COLUMN `match_execution_id`/);
  assert.match(migration, /ADD COLUMN `client_id` text NOT NULL/);

  for (const table of ["audit_packs", "applicability_reviews", "match_executions", "authority_allocations", "case_outcomes", "rule_approvals", "rule_change_history"]) {
    assert.match(migration, new RegExp(`${table}_no_update`));
    assert.match(migration, new RegExp(`${table}_no_delete`));
  }
});
