ALTER TABLE `ai_jobs` ADD COLUMN `client_id` text NOT NULL DEFAULT 'local-client';--> statement-breakpoint
UPDATE `ai_jobs` SET `client_id` = COALESCE(
  (SELECT `client_id` FROM `recovery_cases` WHERE `recovery_cases`.`id` = `ai_jobs`.`case_id` AND `recovery_cases`.`workspace_id` = `ai_jobs`.`workspace_id` LIMIT 1),
  (SELECT `client_id` FROM `evidence_documents` WHERE `evidence_documents`.`id` = `ai_jobs`.`document_id` AND `evidence_documents`.`workspace_id` = `ai_jobs`.`workspace_id` LIMIT 1),
  (SELECT `default_client_id` FROM `workspace_settings` WHERE `workspace_settings`.`workspace_id` = `ai_jobs`.`workspace_id` LIMIT 1),
  `client_id`
);--> statement-breakpoint
ALTER TABLE `authority_allocations` ADD COLUMN `match_execution_id` text;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `uq_extracted_fields_workspace_document_field` ON `extracted_fields` (`workspace_id`,`document_id`,`field_name`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_ledger_imports_workspace_client_hash` ON `ledger_imports` (`workspace_id`,`client_id`,`idempotency_key`) WHERE `idempotency_key` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_candidate_matches_workspace_document_case` ON `candidate_matches` (`workspace_id`,`document_id`,`case_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_candidate_matches_workspace_document_rank` ON `candidate_matches` (`workspace_id`,`document_id`,`rank`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_memberships_workspace_user` ON `workspace_memberships` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_invoices_workspace_client_source` ON `invoices` (`workspace_id`,`client_id`,`source_identity`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_receipts_workspace_document` ON `receipt_records` (`workspace_id`,`document_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_authority_workspace_client_identity` ON `authority_records` (`workspace_id`,`client_id`,`authority_type`,`record_reference`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_authority_successful_receipt` ON `authority_allocations` (`workspace_id`,`authority_record_id`,`receipt_allocation_id`) WHERE `result_code` IN ('matched','matched_within_tolerance');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_rule_sets_workspace_version_client` ON `rule_sets` (`workspace_id`,`version`,`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_rule_sets_workspace_version_global` ON `rule_sets` (`workspace_id`,`version`) WHERE `client_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_case_outcomes_workspace_case` ON `case_outcomes` (`workspace_id`,`case_id`);--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS authority_allocations_balance_guard BEFORE INSERT ON authority_allocations
WHEN NEW.result_code IN ('matched','matched_within_tolerance')
BEGIN
  SELECT (CASE WHEN
    NEW.amount_kobo <= 0 OR
    NEW.amount_kobo + COALESCE((SELECT SUM(amount_kobo) FROM authority_allocations WHERE workspace_id = NEW.workspace_id AND authority_record_id = NEW.authority_record_id AND result_code IN ('matched','matched_within_tolerance')), 0)
      > COALESCE((SELECT amount_kobo FROM authority_records WHERE id = NEW.authority_record_id AND workspace_id = NEW.workspace_id), -1)
    THEN RAISE(ABORT, 'authority allocation exceeds available balance') END);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recovery_case_stage_guard BEFORE UPDATE OF stage ON recovery_cases
WHEN
  (OLD.stage IN ('closed','non-recoverable','written-off') AND NEW.stage <> OLD.stage)
  OR (OLD.stage = 'recognised' AND NEW.stage NOT IN ('recognised','closed'))
BEGIN
  SELECT RAISE(ABORT, 'invalid recovery case transition from locked stage');
END;--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS audit_packs_no_update BEFORE UPDATE ON audit_packs BEGIN SELECT RAISE(ABORT, 'audit_packs are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS audit_packs_no_delete BEFORE DELETE ON audit_packs BEGIN SELECT RAISE(ABORT, 'audit_packs are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS applicability_reviews_no_update BEFORE UPDATE ON applicability_reviews BEGIN SELECT RAISE(ABORT, 'applicability_reviews are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS applicability_reviews_no_delete BEFORE DELETE ON applicability_reviews BEGIN SELECT RAISE(ABORT, 'applicability_reviews are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS match_executions_no_update BEFORE UPDATE ON match_executions BEGIN SELECT RAISE(ABORT, 'match_executions are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS match_executions_no_delete BEFORE DELETE ON match_executions BEGIN SELECT RAISE(ABORT, 'match_executions are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS authority_allocations_no_update BEFORE UPDATE ON authority_allocations BEGIN SELECT RAISE(ABORT, 'authority_allocations are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS authority_allocations_no_delete BEFORE DELETE ON authority_allocations BEGIN SELECT RAISE(ABORT, 'authority_allocations are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS case_outcomes_no_update BEFORE UPDATE ON case_outcomes BEGIN SELECT RAISE(ABORT, 'case_outcomes are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS case_outcomes_no_delete BEFORE DELETE ON case_outcomes BEGIN SELECT RAISE(ABORT, 'case_outcomes are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS rule_approvals_no_update BEFORE UPDATE ON rule_approvals BEGIN SELECT RAISE(ABORT, 'rule_approvals are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS rule_approvals_no_delete BEFORE DELETE ON rule_approvals BEGIN SELECT RAISE(ABORT, 'rule_approvals are append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS rule_change_history_no_update BEFORE UPDATE ON rule_change_history BEGIN SELECT RAISE(ABORT, 'rule_change_history is append-only'); END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS rule_change_history_no_delete BEFORE DELETE ON rule_change_history BEGIN SELECT RAISE(ABORT, 'rule_change_history is append-only'); END;
