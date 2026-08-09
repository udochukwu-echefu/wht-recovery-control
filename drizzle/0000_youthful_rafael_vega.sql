CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text,
	`document_id` text,
	`event_type` text NOT NULL,
	`actor` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_events_case_created` ON `audit_events` (`case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `evidence_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`ai_model` text,
	`ai_response_id` text,
	`error_message` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidence_documents_r2_key_unique` ON `evidence_documents` (`r2_key`);--> statement-breakpoint
CREATE INDEX `idx_evidence_documents_created` ON `evidence_documents` (`created_at`);--> statement-breakpoint
CREATE TABLE `extracted_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`field_name` text NOT NULL,
	`extracted_value` text DEFAULT '' NOT NULL,
	`reviewed_value` text,
	`confidence` integer DEFAULT 0 NOT NULL,
	`evidence_quote` text DEFAULT '' NOT NULL,
	`page_number` integer,
	`reviewed_at` text,
	FOREIGN KEY (`document_id`) REFERENCES `evidence_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_extracted_fields_document` ON `extracted_fields` (`document_id`);--> statement-breakpoint
CREATE TABLE `recovery_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`customer` text NOT NULL,
	`customer_tin` text DEFAULT '' NOT NULL,
	`invoice_reference` text NOT NULL,
	`invoice_gross_kobo` integer NOT NULL,
	`payment_net_kobo` integer NOT NULL,
	`expected_wht_kobo` integer NOT NULL,
	`reporting_period` text DEFAULT '' NOT NULL,
	`receipt_number` text,
	`receipt_amount_kobo` integer,
	`receipt_beneficiary_tin` text,
	`stage` text DEFAULT 'detected' NOT NULL,
	`exception_code` text DEFAULT 'RECEIPT_MISSING' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`source_document_id` text,
	`rule_version` text DEFAULT '2026.07' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recovery_cases_invoice` ON `recovery_cases` (`invoice_reference`);--> statement-breakpoint
CREATE INDEX `idx_recovery_cases_stage_updated` ON `recovery_cases` (`stage`,`updated_at`);