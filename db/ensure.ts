import { getD1 } from ".";

let schemaCheck: Promise<void> | null = null;

/**
 * Verify that versioned D1 migrations were applied. Runtime requests must not
 * attempt schema mutation: doing so is racy, hides failed deploys, and consumes
 * query budget on every cold start.
 */
export function ensureSchema() {
  schemaCheck ??= (async () => {
    const row = await getD1()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_memberships'")
      .first<{ name: string }>();

    if (!row) {
      throw new Error(
        "Database migrations are not applied. Run `wrangler d1 migrations apply wht-recovery-control-db --local` for local development or the remote migration command during deployment.",
      );
    }
  })().catch((error) => {
    schemaCheck = null;
    throw error;
  });

  return schemaCheck;
}
