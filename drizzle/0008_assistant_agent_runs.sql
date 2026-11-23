CREATE TABLE `assistant_agent_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `client_id` text NOT NULL,
  `conversation_id` text NOT NULL REFERENCES `assistant_conversations`(`id`),
  `user_id` text NOT NULL,
  `user_message_id` integer NOT NULL,
  `assistant_message_id` integer NOT NULL,
  `question` text NOT NULL,
  `status` text NOT NULL DEFAULT 'queued' CHECK (`status` IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  `progress_json` text NOT NULL DEFAULT '[]',
  `error_message` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` text
);--> statement-breakpoint
CREATE INDEX `idx_assistant_runs_conversation` ON `assistant_agent_runs` (`conversation_id`, `created_at`);
