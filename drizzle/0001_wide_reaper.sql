CREATE TABLE `ai_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text DEFAULT 'pilot-workspace' NOT NULL,
	`case_id` text,
	`document_id` text,
	`task_type` text NOT NULL,
	`status` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`output_json` text,
	`confidence` integer,
	`source_references_json` text DEFAULT '[]' NOT NULL,
	`latency_ms` integer,
	`validation_outcome` text DEFAULT 'pending' NOT NULL,
	`human_correction` text,
	`error_code` text,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_ai_jobs_created` ON `ai_jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_jobs_task_status` ON `ai_jobs` (`task_type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_ai_jobs_case_created` ON `ai_jobs` (`case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `candidate_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`case_id` text NOT NULL,
	`rank` integer NOT NULL,
	`confidence` integer NOT NULL,
	`reasons_json` text DEFAULT '[]' NOT NULL,
	`conflicts_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `evidence_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`) REFERENCES `recovery_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_candidate_matches_document_rank` ON `candidate_matches` (`document_id`,`rank`);--> statement-breakpoint
CREATE TABLE `case_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`document_id` text NOT NULL,
	`ledger_import_id` text,
	`source_row` integer NOT NULL,
	`source_identity` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `recovery_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `evidence_documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_import_id`) REFERENCES `ledger_imports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_case_sources_case` ON `case_sources` (`case_id`);--> statement-breakpoint
CREATE TABLE `communication_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`draft_type` text NOT NULL,
	`status` text DEFAULT 'generated' NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`ai_job_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`approved_at` text,
	`copied_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_communication_drafts_case_created` ON `communication_drafts` (`case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `document_intelligence` (
	`document_id` text PRIMARY KEY NOT NULL,
	`classification_json` text DEFAULT '{}' NOT NULL,
	`duplicate_json` text DEFAULT '{}' NOT NULL,
	`text_status` text DEFAULT 'uploaded' NOT NULL,
	`provider` text,
	`model` text,
	`prompt_version` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `evidence_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ledger_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`status` text NOT NULL,
	`headers_json` text NOT NULL,
	`preview_json` text NOT NULL,
	`detected_types_json` text NOT NULL,
	`mapping_json` text DEFAULT '[]' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`validation_json` text DEFAULT '{}' NOT NULL,
	`ai_job_id` text,
	`confirmed_by` text,
	`confirmed_at` text,
	`imported_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `evidence_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ledger_imports_document` ON `ledger_imports` (`document_id`);--> statement-breakpoint
CREATE TABLE `match_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`document_id` text NOT NULL,
	`rule_version` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `recovery_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `evidence_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_match_executions_case_created` ON `match_executions` (`case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `recovery_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`plan_json` text NOT NULL,
	`ai_job_id` text,
	`reviewer_note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`accepted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_recovery_plans_case_created` ON `recovery_plans` (`case_id`,`created_at`);