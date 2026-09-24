CREATE TABLE `assistant_conversations` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `client_id` text NOT NULL,
  `user_id` text NOT NULL,
  `title` text NOT NULL DEFAULT 'New conversation',
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);--> statement-breakpoint
CREATE INDEX `idx_assistant_conversations_scope_updated` ON `assistant_conversations` (`workspace_id`, `client_id`, `user_id`, `updated_at`);--> statement-breakpoint
CREATE TABLE `assistant_messages` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `conversation_id` text NOT NULL REFERENCES `assistant_conversations`(`id`),
  `role` text NOT NULL,
  `content` text NOT NULL,
  `metadata_json` text NOT NULL DEFAULT '{}',
  `ai_job_id` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);--> statement-breakpoint
CREATE INDEX `idx_assistant_messages_conversation_id` ON `assistant_messages` (`conversation_id`, `id`);
