CREATE TABLE `assistant_recurring_schedules` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `client_id` text NOT NULL,
  `conversation_id` text NOT NULL REFERENCES `assistant_conversations`(`id`),
  `user_id` text NOT NULL,
  `case_id` text NOT NULL,
  `question` text NOT NULL,
  `starts_at` text NOT NULL,
  `every_days` integer NOT NULL CHECK (`every_days` BETWEEN 1 AND 30),
  `ends_at` text NOT NULL,
  `approval_proposal_id` text NOT NULL UNIQUE REFERENCES `assistant_action_proposals`(`id`),
  `approved_by_user_id` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active','paused','revoked','expired','suspended')),
  `next_run_at` text,
  `last_occurrence_id` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK (`ends_at` > `starts_at`)
);--> statement-breakpoint
CREATE INDEX `idx_recurring_schedules_due` ON `assistant_recurring_schedules` (`status`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `idx_recurring_schedules_scope` ON `assistant_recurring_schedules` (`workspace_id`,`client_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER `recurring_schedule_permission_guard` BEFORE INSERT ON `assistant_recurring_schedules`
WHEN NEW.status <> 'active' OR NOT EXISTS (SELECT 1 FROM assistant_action_proposals p
  WHERE p.id = NEW.approval_proposal_id AND p.status = 'approved' AND p.action_type = 'schedule_followup'
  AND p.workspace_id = NEW.workspace_id AND p.client_id = NEW.client_id AND p.case_id = NEW.case_id
  AND p.conversation_id = NEW.conversation_id AND p.proposed_by_user_id = NEW.user_id AND p.reviewed_by_user_id = NEW.approved_by_user_id
  AND json_extract(p.payload_json,'$.runAt') = NEW.starts_at AND json_extract(p.payload_json,'$.question') = NEW.question
  AND json_extract(p.payload_json,'$.recurrence.everyDays') = NEW.every_days AND json_extract(p.payload_json,'$.recurrence.until') = NEW.ends_at)
BEGIN SELECT RAISE(ABORT, 'recurring work requires exact approved permission'); END;--> statement-breakpoint
CREATE TRIGGER `recurring_schedule_immutable_permission` BEFORE UPDATE ON `assistant_recurring_schedules`
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.client_id IS NOT OLD.client_id
  OR NEW.conversation_id IS NOT OLD.conversation_id OR NEW.user_id IS NOT OLD.user_id OR NEW.case_id IS NOT OLD.case_id
  OR NEW.question IS NOT OLD.question OR NEW.starts_at IS NOT OLD.starts_at OR NEW.every_days IS NOT OLD.every_days
  OR NEW.ends_at IS NOT OLD.ends_at OR NEW.approval_proposal_id IS NOT OLD.approval_proposal_id
  OR NEW.approved_by_user_id IS NOT OLD.approved_by_user_id OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.status <> 'active' AND NEW.status = 'active') OR (OLD.status = 'revoked' AND NEW.status <> 'revoked')
BEGIN SELECT RAISE(ABORT, 'recurring permission changes require a new approval'); END;--> statement-breakpoint
CREATE TRIGGER `recurring_schedules_no_delete` BEFORE DELETE ON `assistant_recurring_schedules`
BEGIN SELECT RAISE(ABORT, 'recurring permissions are retained'); END;--> statement-breakpoint
CREATE TABLE `assistant_schedule_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `event_key` text NOT NULL UNIQUE,
  `schedule_id` text NOT NULL REFERENCES `assistant_recurring_schedules`(`id`),
  `workspace_id` text NOT NULL,
  `client_id` text NOT NULL,
  `event_type` text NOT NULL,
  `payload_json` text NOT NULL CHECK (json_valid(`payload_json`)),
  `created_at` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_schedule_events_schedule` ON `assistant_schedule_events` (`schedule_id`,`id`);--> statement-breakpoint
CREATE TRIGGER `schedule_events_scope_guard` BEFORE INSERT ON `assistant_schedule_events`
WHEN NOT EXISTS (SELECT 1 FROM assistant_recurring_schedules s WHERE s.id = NEW.schedule_id AND s.workspace_id = NEW.workspace_id AND s.client_id = NEW.client_id)
BEGIN SELECT RAISE(ABORT, 'schedule history scope is invalid'); END;--> statement-breakpoint
CREATE TRIGGER `schedule_events_no_update` BEFORE UPDATE ON `assistant_schedule_events`
BEGIN SELECT RAISE(ABORT, 'schedule history is append-only'); END;--> statement-breakpoint
CREATE TRIGGER `schedule_events_no_delete` BEFORE DELETE ON `assistant_schedule_events`
BEGIN SELECT RAISE(ABORT, 'schedule history is append-only'); END;--> statement-breakpoint
ALTER TABLE `assistant_agent_runs` ADD COLUMN `recurring_schedule_id` text REFERENCES `assistant_recurring_schedules`(`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_recurring_run_occurrence` ON `assistant_agent_runs` (`recurring_schedule_id`,`scheduled_for`) WHERE `recurring_schedule_id` IS NOT NULL;--> statement-breakpoint
DROP TRIGGER `assistant_runs_scope_guard`;--> statement-breakpoint
CREATE TRIGGER `assistant_runs_scope_guard` BEFORE INSERT ON `assistant_agent_runs`
WHEN NOT EXISTS (SELECT 1 FROM assistant_conversations a
  JOIN assistant_messages um ON um.id = NEW.user_message_id AND um.conversation_id = a.id AND um.role = 'user'
  JOIN assistant_messages am ON am.id = NEW.assistant_message_id AND am.conversation_id = a.id AND am.role = 'assistant'
  WHERE a.id = NEW.conversation_id AND a.workspace_id = NEW.workspace_id AND a.client_id = NEW.client_id AND a.user_id = NEW.user_id)
  OR (NEW.case_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM recovery_cases rc WHERE rc.id = NEW.case_id AND rc.workspace_id = NEW.workspace_id AND rc.client_id = NEW.client_id AND rc.deleted_at IS NULL))
  OR (NEW.scheduled_for IS NOT NULL AND NEW.recurring_schedule_id IS NULL AND NOT EXISTS (SELECT 1 FROM assistant_action_proposals p WHERE p.id = NEW.approval_proposal_id
    AND p.workspace_id = NEW.workspace_id AND p.client_id = NEW.client_id AND p.case_id = NEW.case_id
    AND p.proposed_by_user_id = NEW.user_id AND p.status = 'approved' AND p.action_type = 'schedule_followup'
    AND json_extract(p.payload_json, '$.recurrence') IS NULL
    AND json_extract(p.payload_json, '$.runAt') = NEW.scheduled_for AND json_extract(p.payload_json, '$.question') = NEW.question))
  OR (NEW.recurring_schedule_id IS NOT NULL AND (NEW.approval_proposal_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM assistant_recurring_schedules s
    WHERE s.id = NEW.recurring_schedule_id AND s.status = 'active' AND s.workspace_id = NEW.workspace_id AND s.client_id = NEW.client_id
    AND s.case_id = NEW.case_id AND s.user_id = NEW.user_id AND s.conversation_id = NEW.conversation_id AND s.question = NEW.question
    AND NEW.scheduled_for IS NOT NULL AND NEW.scheduled_for >= s.starts_at AND NEW.scheduled_for < s.ends_at)))
BEGIN SELECT RAISE(ABORT, 'assistant investigation scope or approval is invalid'); END;--> statement-breakpoint
CREATE TRIGGER `recurring_run_request_immutable` BEFORE UPDATE ON `assistant_agent_runs`
WHEN NEW.recurring_schedule_id IS NOT OLD.recurring_schedule_id
BEGIN SELECT RAISE(ABORT, 'recurring run permission is immutable'); END;--> statement-breakpoint
CREATE TABLE `communication_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `client_id` text NOT NULL,
  `case_id` text NOT NULL,
  `draft_id` text NOT NULL REFERENCES `communication_drafts`(`id`),
  `draft_version` integer NOT NULL,
  `case_updated_at` text NOT NULL,
  `from_address` text NOT NULL,
  `to_address` text NOT NULL,
  `subject` text NOT NULL,
  `body` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending' CHECK (`status` IN ('pending','rejected','canceled','sending','accepted','failed','unknown')),
  `requested_by_user_id` text NOT NULL,
  `reviewed_by_user_id` text,
  `reviewer_note` text,
  `decision_id` text,
  `provider_message_id` text,
  `error_message` text,
  `created_at` text NOT NULL,
  `reviewed_at` text,
  `attempted_at` text,
  `completed_at` text
);--> statement-breakpoint
CREATE INDEX `idx_deliveries_scope_created` ON `communication_deliveries` (`workspace_id`,`client_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_draft_unresolved_delivery` ON `communication_deliveries` (`draft_id`) WHERE `status` IN ('pending','sending','accepted','unknown');--> statement-breakpoint
CREATE TRIGGER `delivery_scope_guard` BEFORE INSERT ON `communication_deliveries`
WHEN NEW.status <> 'pending' OR NOT EXISTS (SELECT 1 FROM communication_drafts d JOIN recovery_cases rc ON rc.id = d.case_id AND rc.workspace_id = d.workspace_id
  WHERE d.id = NEW.draft_id AND d.workspace_id = NEW.workspace_id AND rc.client_id = NEW.client_id AND rc.id = NEW.case_id AND rc.deleted_at IS NULL
  AND d.approved_at IS NOT NULL AND d.status IN ('approved','copied') AND d.version = NEW.draft_version AND d.subject = NEW.subject AND d.body = NEW.body)
BEGIN SELECT RAISE(ABORT, 'delivery requires a scoped approved draft'); END;--> statement-breakpoint
CREATE TRIGGER `delivery_immutable_effects` BEFORE UPDATE ON `communication_deliveries`
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.client_id IS NOT OLD.client_id
  OR NEW.case_id IS NOT OLD.case_id OR NEW.draft_id IS NOT OLD.draft_id OR NEW.draft_version IS NOT OLD.draft_version
  OR NEW.case_updated_at IS NOT OLD.case_updated_at OR NEW.from_address IS NOT OLD.from_address OR NEW.to_address IS NOT OLD.to_address
  OR NEW.subject IS NOT OLD.subject OR NEW.body IS NOT OLD.body OR NEW.requested_by_user_id IS NOT OLD.requested_by_user_id OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.status <> 'pending' AND (NEW.reviewed_by_user_id IS NOT OLD.reviewed_by_user_id OR NEW.reviewer_note IS NOT OLD.reviewer_note OR NEW.decision_id IS NOT OLD.decision_id OR NEW.reviewed_at IS NOT OLD.reviewed_at))
  OR (OLD.status = 'pending' AND NEW.status NOT IN ('rejected','canceled','sending'))
  OR (OLD.status = 'sending' AND NEW.status NOT IN ('accepted','failed','unknown'))
  OR (OLD.status IN ('accepted','failed','unknown','rejected','canceled'))
BEGIN SELECT RAISE(ABORT, 'delivery effects and consumed permissions are immutable'); END;--> statement-breakpoint
CREATE TRIGGER `deliveries_no_delete` BEFORE DELETE ON `communication_deliveries`
BEGIN SELECT RAISE(ABORT, 'delivery permissions are retained'); END;
