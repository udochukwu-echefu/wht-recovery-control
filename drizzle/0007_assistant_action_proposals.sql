CREATE TABLE `assistant_action_proposals` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `client_id` text NOT NULL,
  `conversation_id` text NOT NULL REFERENCES `assistant_conversations`(`id`),
  `ai_job_id` text NOT NULL,
  `case_id` text NOT NULL,
  `case_updated_at` text NOT NULL,
  `action_type` text NOT NULL CHECK (`action_type` IN ('case_note')),
  `payload_json` text NOT NULL,
  `source_labels_json` text NOT NULL DEFAULT '[]',
  `status` text NOT NULL DEFAULT 'pending' CHECK (`status` IN ('pending', 'approved', 'rejected')),
  `proposed_by_user_id` text NOT NULL,
  `reviewed_by_user_id` text,
  `reviewer_note` text,
  `decision_id` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` text
);--> statement-breakpoint
CREATE INDEX `idx_assistant_proposals_conversation` ON `assistant_action_proposals` (`conversation_id`, `created_at`);--> statement-breakpoint
CREATE INDEX `idx_assistant_proposals_case_status` ON `assistant_action_proposals` (`case_id`, `status`);
