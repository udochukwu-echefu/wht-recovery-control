CREATE TABLE `applicability_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`case_id` text NOT NULL,
	`invoice_id` text,
	`payment_id` text,
	`calculated_gap_kobo` integer NOT NULL,
	`outcome` text NOT NULL,
	`transaction_category` text DEFAULT '' NOT NULL,
	`expected_rate_bps` integer,
	`confirmed_expected_kobo` integer,
	`exemption_reason` text,
	`reviewer_note` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`reviewer_display_name` text NOT NULL,
	`rule_version` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_applicability_case_created` ON `applicability_reviews` (`case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`case_id` text NOT NULL,
	`format` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`manifest_json` text NOT NULL,
	`generated_by_user_id` text NOT NULL,
	`generated_at` text NOT NULL,
	`snapshot_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_packs_case_generated` ON `audit_packs` (`case_id`,`generated_at`);--> statement-breakpoint
CREATE TABLE `authority_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`authority_record_id` text NOT NULL,
	`case_id` text NOT NULL,
	`receipt_allocation_id` text,
	`amount_kobo` integer NOT NULL,
	`result_code` text NOT NULL,
	`result_json` text NOT NULL,
	`rule_version` text NOT NULL,
	`verified_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_authority_allocations_case` ON `authority_allocations` (`case_id`);--> statement-breakpoint
CREATE INDEX `idx_authority_allocations_record` ON `authority_allocations` (`authority_record_id`);--> statement-breakpoint
CREATE TABLE `authority_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`document_id` text,
	`authority_type` text NOT NULL,
	`jurisdiction` text NOT NULL,
	`record_reference` text NOT NULL,
	`beneficiary_tin` text NOT NULL,
	`deducting_customer_tin` text NOT NULL,
	`amount_kobo` integer NOT NULL,
	`reporting_period` text NOT NULL,
	`filing_date` text,
	`credit_status` text NOT NULL,
	`verification_state` text DEFAULT 'unverified' NOT NULL,
	`source_row` integer,
	`verified_by_user_id` text,
	`verified_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_authority_workspace_reference` ON `authority_records` (`workspace_id`,`record_reference`);--> statement-breakpoint
CREATE TABLE `case_checklist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`case_id` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`completed_by_user_id` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_case_checklist_case` ON `case_checklist_items` (`case_id`);--> statement-breakpoint
CREATE TABLE `case_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`case_id` text NOT NULL,
	`body` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_case_notes_case_created` ON `case_notes` (`case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `case_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`case_id` text NOT NULL,
	`outcome_type` text NOT NULL,
	`amount_kobo` integer NOT NULL,
	`effective_date` text NOT NULL,
	`reviewer_user_id` text NOT NULL,
	`approver_user_id` text,
	`evidence_document_id` text,
	`decision_note` text NOT NULL,
	`rule_version` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_case_outcomes_case_effective` ON `case_outcomes` (`case_id`,`effective_date`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`legal_name` text NOT NULL,
	`entity_type` text DEFAULT 'company' NOT NULL,
	`jurisdiction` text DEFAULT 'federal' NOT NULL,
	`tin` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_clients_workspace` ON `clients` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `correspondence_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`case_id` text NOT NULL,
	`draft_id` text,
	`direction` text NOT NULL,
	`channel` text NOT NULL,
	`event_type` text NOT NULL,
	`subject` text,
	`body` text,
	`occurred_at` text NOT NULL,
	`recorded_by_user_id` text NOT NULL,
	`source_document_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_correspondence_case_occurred` ON `correspondence_events` (`case_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`external_reference` text,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`tin` text DEFAULT '' NOT NULL,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`source_document_id` text,
	`source_row` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_customers_workspace_client` ON `customers` (`workspace_id`,`client_id`);--> statement-breakpoint
CREATE INDEX `idx_customers_workspace_tin` ON `customers` (`workspace_id`,`tin`);--> statement-breakpoint
CREATE TABLE `entity_tax_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`authority_type` text NOT NULL,
	`jurisdiction` text NOT NULL,
	`tin` text NOT NULL,
	`legal_name` text NOT NULL,
	`effective_from` text,
	`effective_to` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tax_identities_workspace_client` ON `entity_tax_identities` (`workspace_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`reference` text NOT NULL,
	`corrected_reference` text,
	`issue_date` text,
	`gross_kobo` integer NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reversal_of_id` text,
	`source_document_id` text,
	`source_row` integer,
	`source_identity` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_invoices_workspace_reference` ON `invoices` (`workspace_id`,`reference`);--> statement-breakpoint
CREATE INDEX `idx_invoices_customer` ON `invoices` (`customer_id`);--> statement-breakpoint
CREATE TABLE `payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`amount_kobo` integer NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_payment_allocations_payment` ON `payment_allocations` (`payment_id`);--> statement-breakpoint
CREATE INDEX `idx_payment_allocations_invoice` ON `payment_allocations` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`reference` text NOT NULL,
	`payment_date` text NOT NULL,
	`amount_kobo` integer NOT NULL,
	`currency` text DEFAULT 'NGN' NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`reversal_of_id` text,
	`source_document_id` text,
	`source_row` integer,
	`source_identity` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_payments_workspace_reference` ON `payments` (`workspace_id`,`reference`);--> statement-breakpoint
CREATE INDEX `idx_payments_customer` ON `payments` (`customer_id`);--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`window_started_at` text NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `receipt_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`receipt_id` text NOT NULL,
	`case_id` text NOT NULL,
	`invoice_id` text,
	`amount_kobo` integer NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`confirmed_by_user_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_receipt_allocations_receipt` ON `receipt_allocations` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `idx_receipt_allocations_case` ON `receipt_allocations` (`case_id`);--> statement-breakpoint
CREATE TABLE `receipt_records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`client_id` text NOT NULL,
	`document_id` text NOT NULL,
	`receipt_reference` text,
	`deducting_customer_id` text,
	`deducting_customer_tin` text,
	`beneficiary_tin` text,
	`amount_kobo` integer,
	`reporting_period` text,
	`receipt_date` text,
	`status` text DEFAULT 'review_required' NOT NULL,
	`extraction_reviewed_at` text,
	`extraction_reviewed_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_receipts_workspace_reference` ON `receipt_records` (`workspace_id`,`receipt_reference`);--> statement-breakpoint
CREATE TABLE `rule_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`rule_set_id` text NOT NULL,
	`approver_user_id` text NOT NULL,
	`role` text NOT NULL,
	`decision` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rule_approvals_set` ON `rule_approvals` (`rule_set_id`);--> statement-breakpoint
CREATE TABLE `rule_change_history` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`rule_set_id` text NOT NULL,
	`change_type` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	`changed_by_user_id` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rule_history_set_created` ON `rule_change_history` (`rule_set_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rule_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`rule_set_id` text NOT NULL,
	`rule_code` text NOT NULL,
	`definition_json` text NOT NULL,
	`practitioner_note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rule_definitions_set` ON `rule_definitions` (`rule_set_id`);--> statement-breakpoint
CREATE TABLE `rule_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`effective_start` text NOT NULL,
	`effective_end` text,
	`client_id` text,
	`jurisdiction` text,
	`tolerances_json` text DEFAULT '{}' NOT NULL,
	`applicability_categories_json` text DEFAULT '[]' NOT NULL,
	`practitioner_notes` text DEFAULT '' NOT NULL,
	`change_reason` text NOT NULL,
	`approved_by_user_id` text,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_rule_sets_workspace_status` ON `rule_sets` (`workspace_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_subject` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_provider_subject_unique` ON `users` (`provider_subject`);--> statement-breakpoint
CREATE TABLE `workspace_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_memberships_user_workspace` ON `workspace_memberships` (`user_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `workspace_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`max_file_bytes` integer DEFAULT 1048576 NOT NULL,
	`max_storage_bytes` integer DEFAULT 25000000 NOT NULL,
	`retention_days` integer DEFAULT 365 NOT NULL,
	`default_client_id` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`mode` text DEFAULT 'live' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `attempt_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `max_attempts` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `next_retry_at` text;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `lease_owner` text;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `lease_expires_at` text;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `provider_response_id` text;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `input_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `output_tokens` integer;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `estimated_cost_micros` integer;--> statement-breakpoint
ALTER TABLE `ai_jobs` ADD `requested_by_user_id` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `actor_user_id` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `actor_display_name` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `actor_role` text;--> statement-breakpoint
CREATE INDEX `idx_audit_events_workspace_created` ON `audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `candidate_matches` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `case_sources` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `communication_drafts` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `communication_drafts` ADD `approved_by_user_id` text;--> statement-breakpoint
ALTER TABLE `communication_drafts` ADD `copied_by_user_id` text;--> statement-breakpoint
ALTER TABLE `communication_drafts` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `communication_drafts` ADD `source_snapshot_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `document_intelligence` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `evidence_blobs` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `evidence_blobs` ADD `size_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `evidence_blobs` ADD `sha256` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `evidence_blobs` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `idx_evidence_blobs_workspace_sha` ON `evidence_blobs` (`workspace_id`,`sha256`);--> statement-breakpoint
ALTER TABLE `evidence_documents` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `evidence_documents` ADD `client_id` text DEFAULT 'local-client' NOT NULL;--> statement-breakpoint
ALTER TABLE `evidence_documents` ADD `retention_until` text;--> statement-breakpoint
ALTER TABLE `evidence_documents` ADD `quarantined_at` text;--> statement-breakpoint
ALTER TABLE `evidence_documents` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `idx_evidence_documents_workspace_sha` ON `evidence_documents` (`workspace_id`,`sha256`);--> statement-breakpoint
ALTER TABLE `extracted_fields` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `extracted_fields` ADD `reviewed_by_user_id` text;--> statement-breakpoint
ALTER TABLE `ledger_imports` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_imports` ADD `client_id` text DEFAULT 'local-client' NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_imports` ADD `source_type` text DEFAULT 'invoice_payment_ledger' NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_imports` ADD `idempotency_key` text;--> statement-breakpoint
ALTER TABLE `match_executions` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `match_executions` ADD `factors_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `match_executions` ADD `conflicts_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `match_executions` ADD `tolerance_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `client_id` text DEFAULT 'local-client' NOT NULL;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `applicability_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `assigned_owner_id` text;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `owner_role` text;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `priority` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `next_action` text;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `escalation_date` text;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `last_contact_date` text;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `expected_response_date` text;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `business_date` text;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `tags_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `recovery_cases` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `idx_recovery_cases_workspace_client` ON `recovery_cases` (`workspace_id`,`client_id`);--> statement-breakpoint
ALTER TABLE `recovery_plans` ADD `workspace_id` text DEFAULT 'local-workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE `recovery_plans` ADD `accepted_by_user_id` text;
