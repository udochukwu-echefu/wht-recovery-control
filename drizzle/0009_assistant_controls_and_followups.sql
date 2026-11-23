-- Extend the existing local proposals without rewriting migrations 0007/0008.
CREATE TABLE `assistant_action_proposals_v2` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `client_id` text NOT NULL,
  `conversation_id` text NOT NULL REFERENCES `assistant_conversations`(`id`),
  `ai_job_id` text NOT NULL,
  `case_id` text NOT NULL,
  `case_updated_at` text NOT NULL,
  `action_type` text NOT NULL CHECK (`action_type` IN ('case_note', 'case_assignment', 'case_priority', 'case_due_date', 'case_checklist', 'communication_draft', 'schedule_followup')),
  `payload_json` text NOT NULL CHECK (json_valid(`payload_json`)),
  `source_labels_json` text NOT NULL DEFAULT '[]' CHECK (json_valid(`source_labels_json`)),
  `status` text NOT NULL DEFAULT 'pending' CHECK (`status` IN ('pending', 'approved', 'rejected')),
  `proposed_by_user_id` text NOT NULL,
  `reviewed_by_user_id` text,
  `reviewer_note` text,
  `decision_id` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` text
);--> statement-breakpoint
INSERT INTO `assistant_action_proposals_v2` SELECT * FROM `assistant_action_proposals`;--> statement-breakpoint
DROP TABLE `assistant_action_proposals`;--> statement-breakpoint
ALTER TABLE `assistant_action_proposals_v2` RENAME TO `assistant_action_proposals`;--> statement-breakpoint
CREATE INDEX `idx_assistant_proposals_conversation` ON `assistant_action_proposals` (`conversation_id`, `created_at`);--> statement-breakpoint
CREATE INDEX `idx_assistant_proposals_case_status` ON `assistant_action_proposals` (`case_id`, `status`);--> statement-breakpoint
CREATE INDEX `idx_assistant_proposals_scope_status` ON `assistant_action_proposals` (`workspace_id`, `client_id`, `status`, `created_at`);--> statement-breakpoint
CREATE TRIGGER `assistant_proposals_immutable_effects` BEFORE UPDATE ON `assistant_action_proposals`
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.client_id IS NOT OLD.client_id
  OR NEW.conversation_id IS NOT OLD.conversation_id OR NEW.ai_job_id IS NOT OLD.ai_job_id
  OR NEW.case_id IS NOT OLD.case_id OR NEW.case_updated_at IS NOT OLD.case_updated_at
  OR NEW.action_type IS NOT OLD.action_type OR NEW.payload_json IS NOT OLD.payload_json
  OR NEW.source_labels_json IS NOT OLD.source_labels_json OR NEW.proposed_by_user_id IS NOT OLD.proposed_by_user_id
  OR NEW.created_at IS NOT OLD.created_at OR OLD.status <> 'pending' OR NEW.status = 'pending'
BEGIN SELECT RAISE(ABORT, 'assistant proposal effects and reviewed decisions are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `assistant_proposals_no_delete` BEFORE DELETE ON `assistant_action_proposals`
BEGIN SELECT RAISE(ABORT, 'assistant proposals are retained for review'); END;--> statement-breakpoint
CREATE TRIGGER `assistant_proposals_scope_guard` BEFORE INSERT ON `assistant_action_proposals`
WHEN NOT EXISTS (SELECT 1 FROM assistant_conversations a JOIN recovery_cases rc
  ON rc.id = NEW.case_id AND rc.workspace_id = a.workspace_id AND rc.client_id = a.client_id AND rc.deleted_at IS NULL
  JOIN workspace_memberships m ON m.workspace_id = a.workspace_id AND m.user_id = a.user_id AND m.status = 'active'
  JOIN users u ON u.id = m.user_id AND u.status = 'active'
  WHERE a.id = NEW.conversation_id AND a.workspace_id = NEW.workspace_id AND a.client_id = NEW.client_id
  AND a.user_id = NEW.proposed_by_user_id AND m.role IN ('admin','practitioner','reviewer'))
BEGIN SELECT RAISE(ABORT, 'assistant proposal scope is invalid'); END;--> statement-breakpoint
ALTER TABLE `assistant_agent_runs` ADD COLUMN `case_id` text;--> statement-breakpoint
ALTER TABLE `assistant_agent_runs` ADD COLUMN `scheduled_for` text;--> statement-breakpoint
ALTER TABLE `assistant_agent_runs` ADD COLUMN `approval_proposal_id` text;--> statement-breakpoint
ALTER TABLE `assistant_agent_runs` ADD COLUMN `dispatched_at` text;--> statement-breakpoint
ALTER TABLE `assistant_agent_runs` ADD COLUMN `dispatch_attempts` integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE INDEX `idx_assistant_runs_scope_created` ON `assistant_agent_runs` (`workspace_id`, `client_id`, `created_at`);--> statement-breakpoint
CREATE INDEX `idx_assistant_runs_dispatch` ON `assistant_agent_runs` (`status`, `dispatched_at`, `dispatch_attempts`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_assistant_followup_approval` ON `assistant_agent_runs` (`approval_proposal_id`) WHERE `approval_proposal_id` IS NOT NULL;--> statement-breakpoint
CREATE TRIGGER `assistant_runs_scope_guard` BEFORE INSERT ON `assistant_agent_runs`
WHEN NOT EXISTS (SELECT 1 FROM assistant_conversations a
  JOIN assistant_messages um ON um.id = NEW.user_message_id AND um.conversation_id = a.id AND um.role = 'user'
  JOIN assistant_messages am ON am.id = NEW.assistant_message_id AND am.conversation_id = a.id AND am.role = 'assistant'
  WHERE a.id = NEW.conversation_id AND a.workspace_id = NEW.workspace_id AND a.client_id = NEW.client_id AND a.user_id = NEW.user_id)
  OR (NEW.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM recovery_cases rc WHERE rc.id = NEW.case_id AND rc.workspace_id = NEW.workspace_id AND rc.client_id = NEW.client_id AND rc.deleted_at IS NULL))
  OR (NEW.scheduled_for IS NOT NULL AND NOT EXISTS (SELECT 1 FROM assistant_action_proposals p WHERE p.id = NEW.approval_proposal_id
    AND p.workspace_id = NEW.workspace_id AND p.client_id = NEW.client_id AND p.case_id = NEW.case_id
    AND p.proposed_by_user_id = NEW.user_id AND p.status = 'approved' AND p.action_type = 'schedule_followup'
    AND json_extract(p.payload_json, '$.runAt') = NEW.scheduled_for AND json_extract(p.payload_json, '$.question') = NEW.question))
BEGIN SELECT RAISE(ABORT, 'assistant investigation scope or approval is invalid'); END;--> statement-breakpoint
CREATE TRIGGER `assistant_runs_immutable_request` BEFORE UPDATE ON `assistant_agent_runs`
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.client_id IS NOT OLD.client_id
  OR NEW.conversation_id IS NOT OLD.conversation_id OR NEW.user_id IS NOT OLD.user_id
  OR NEW.user_message_id IS NOT OLD.user_message_id OR NEW.assistant_message_id IS NOT OLD.assistant_message_id
  OR NEW.question IS NOT OLD.question OR NEW.case_id IS NOT OLD.case_id OR NEW.scheduled_for IS NOT OLD.scheduled_for
  OR NEW.approval_proposal_id IS NOT OLD.approval_proposal_id
  OR (OLD.status IN ('completed','failed','canceled') AND NEW.status IS NOT OLD.status)
BEGIN SELECT RAISE(ABORT, 'assistant investigation request and terminal status are immutable'); END;--> statement-breakpoint
CREATE TABLE `assistant_run_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event_key` text NOT NULL UNIQUE,
  `run_id` text NOT NULL REFERENCES `assistant_agent_runs`(`id`),
  `workspace_id` text NOT NULL,
  `client_id` text NOT NULL,
  `attempt` integer NOT NULL DEFAULT 0,
  `event_type` text NOT NULL,
  `payload_json` text NOT NULL CHECK (json_valid(`payload_json`)),
  `created_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_assistant_run_events_run` ON `assistant_run_events` (`run_id`, `id`);--> statement-breakpoint
CREATE TRIGGER `assistant_run_events_scope_guard` BEFORE INSERT ON `assistant_run_events`
WHEN NOT EXISTS (SELECT 1 FROM assistant_agent_runs r WHERE r.id = NEW.run_id AND r.workspace_id = NEW.workspace_id AND r.client_id = NEW.client_id)
BEGIN SELECT RAISE(ABORT, 'assistant run event scope is invalid'); END;--> statement-breakpoint
-- Prior runs retain the surviving summary; missing historical tool details
-- cannot be reconstructed. New runs record each attempt and tool result.
INSERT INTO `assistant_run_events` (`event_key`, `run_id`, `workspace_id`, `client_id`, `event_type`, `payload_json`, `created_at`)
SELECT r.id || ':legacy-snapshot', r.id, r.workspace_id, r.client_id, 'legacy_snapshot',
  json_object('status', r.status, 'progress', json(r.progress_json), 'output', json(COALESCE(j.output_json, 'null')), 'error', r.error_message), r.updated_at
FROM `assistant_agent_runs` r LEFT JOIN `ai_jobs` j ON j.id = r.id AND j.workspace_id = r.workspace_id AND j.client_id = r.client_id;--> statement-breakpoint
CREATE TRIGGER `assistant_run_events_no_update` BEFORE UPDATE ON `assistant_run_events`
BEGIN SELECT RAISE(ABORT, 'assistant run history is append-only'); END;--> statement-breakpoint
CREATE TRIGGER `assistant_run_events_no_delete` BEFORE DELETE ON `assistant_run_events`
BEGIN SELECT RAISE(ABORT, 'assistant run history is append-only'); END;--> statement-breakpoint
-- Related operational edits invalidate a proposal even when a route only
-- inserts a note, checklist item or draft rather than updating the case row.
CREATE TRIGGER `case_notes_advance_case_version` AFTER INSERT ON `case_notes`
BEGIN UPDATE recovery_cases SET updated_at = MAX(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')) WHERE id = NEW.case_id AND workspace_id = NEW.workspace_id; END;--> statement-breakpoint
CREATE TRIGGER `case_checklist_advance_case_version` AFTER INSERT ON `case_checklist_items`
BEGIN UPDATE recovery_cases SET updated_at = MAX(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')) WHERE id = NEW.case_id AND workspace_id = NEW.workspace_id; END;--> statement-breakpoint
CREATE TRIGGER `communication_drafts_advance_case_version` AFTER INSERT ON `communication_drafts`
BEGIN UPDATE recovery_cases SET updated_at = MAX(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')) WHERE id = NEW.case_id AND workspace_id = NEW.workspace_id; END;
