export const assistantApproverRoles = ["admin", "practitioner", "reviewer"] as const;
export const assistantActionTypes = ["case_note", "case_assignment", "case_priority", "case_due_date", "case_checklist", "communication_draft", "schedule_followup"] as const;
export type AssistantActionType = (typeof assistantActionTypes)[number];

export type ActionPayload =
  | { body: string }
  | { ownerId: string; ownerName: string; ownerRole: string }
  | { priority: "low" | "standard" | "high" | "critical" }
  | { dueDate: string | null }
  | { label: string }
  | { channel: "email" | "letter"; recipient: string; subject: string; body: string }
  | { runAt: string; question: string; recurrence?: { everyDays: number; until: string }; replacesScheduleId?: string; replacesScheduleVersion?: string };

export type PreparedAction = { actionType: AssistantActionType; caseId: string; caseUpdatedAt: string; customer: string; payload: ActionPayload };
export type ActionProposalPreview = PreparedAction & {
  id: string;
  status: "pending" | "approved" | "rejected";
  sourceLabels: string[];
  previewHash: string;
  reviewedAt?: string | null;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Action payload must be an object.");
  return value as Record<string, unknown>;
}

function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in value))) throw new Error("Action payload contains missing or unsupported fields.");
}

function text(value: unknown, min: number, max: number) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) throw new Error(`Action text must contain ${min} to ${max} characters.`);
  return value.trim();
}

export function calendarDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("A valid calendar date is required.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error("A valid calendar date is required.");
  return value;
}

export function followupTime(value: unknown, checkFuture = true, now = Date.now()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error("Follow-up time must include a date, time and explicit timezone.");
  calendarDate(value.slice(0, 10));
  const time = Date.parse(value);
  if (!Number.isFinite(time) || (checkFuture && (time <= now || time > now + 90 * 86_400_000))) throw new Error("Schedule a follow-up in the future, within 90 days.");
  return new Date(time).toISOString();
}

export function validateActionPayload(actionType: string, value: unknown, checkFuture = true): ActionPayload {
  const payload = record(value);
  switch (actionType) {
    case "case_note":
      fields(payload, ["body"]);
      return { body: text(payload.body, 12, 750) };
    case "case_assignment": {
      fields(payload, ["ownerId", "ownerName", "ownerRole"]);
      const ownerId = text(payload.ownerId, 1, 100);
      if (!/^[A-Za-z0-9_-]+$/.test(ownerId) || typeof payload.ownerRole !== "string" || !["admin", "practitioner", "reviewer", "analyst"].includes(payload.ownerRole)) throw new Error("The proposed case owner is invalid.");
      return { ownerId, ownerName: text(payload.ownerName, 1, 180), ownerRole: payload.ownerRole };
    }
    case "case_priority":
      fields(payload, ["priority"]);
      if (typeof payload.priority !== "string" || !["low", "standard", "high", "critical"].includes(payload.priority)) throw new Error("Case priority is invalid.");
      return { priority: payload.priority as "low" | "standard" | "high" | "critical" };
    case "case_due_date":
      fields(payload, ["dueDate"]);
      return { dueDate: payload.dueDate === null ? null : calendarDate(payload.dueDate) };
    case "case_checklist":
      fields(payload, ["label"]);
      return { label: text(payload.label, 2, 180) };
    case "communication_draft":
      fields(payload, ["channel", "recipient", "subject", "body"]);
      if (payload.channel !== "email" && payload.channel !== "letter") throw new Error("Draft channel is invalid.");
      return { channel: payload.channel, recipient: text(payload.recipient, 2, 180), subject: text(payload.subject, 2, 180), body: text(payload.body, 12, 4_000) };
    case "schedule_followup":
    {
      const optional = ["recurrence", "replacesScheduleId", "replacesScheduleVersion"].filter((key) => key in payload);
      fields(payload, ["runAt", "question", ...optional]);
      const runAt = followupTime(payload.runAt, checkFuture);
      const result: Extract<ActionPayload, { runAt: string }> = { runAt, question: text(payload.question, 2, 300) };
      if (payload.recurrence !== undefined) {
        const recurrence = record(payload.recurrence);
        fields(recurrence, ["everyDays", "until"]);
        if (typeof recurrence.everyDays !== "number" || !Number.isInteger(recurrence.everyDays) || recurrence.everyDays < 1 || recurrence.everyDays > 30) throw new Error("Repeat every 1 to 30 days.");
        const until = followupTime(recurrence.until, checkFuture);
        if (Date.parse(until) <= Date.parse(runAt)) throw new Error("The recurring permission must expire after its first run.");
        result.recurrence = { everyDays: recurrence.everyDays, until };
      }
      if (payload.replacesScheduleId !== undefined) {
        if (!result.recurrence || typeof payload.replacesScheduleId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.replacesScheduleId)) throw new Error("A valid recurring permission to replace is required.");
        result.replacesScheduleId = payload.replacesScheduleId;
        result.replacesScheduleVersion = text(payload.replacesScheduleVersion, 1, 100);
      }
      if (payload.replacesScheduleVersion !== undefined && !result.replacesScheduleId) throw new Error("A permission version requires a recurring permission to replace.");
      return result;
    }
    default:
      throw new Error("This proposal action is unsupported.");
  }
}

export const actionTitles: Record<AssistantActionType, string> = {
  case_note: "Case note",
  case_assignment: "Case assignment",
  case_priority: "Case priority",
  case_due_date: "Case due date",
  case_checklist: "Checklist item",
  communication_draft: "Correspondence draft",
  schedule_followup: "Scheduled internal follow-up",
};

export function actionDescription(actionType: AssistantActionType, payload: ActionPayload) {
  if (actionType === "case_note" && "body" in payload) return payload.body;
  if ("ownerId" in payload) return `Assign to ${payload.ownerName} (${payload.ownerRole}; ${payload.ownerId}).`;
  if ("priority" in payload) return `Set priority to ${payload.priority}.`;
  if ("dueDate" in payload) return payload.dueDate ? `Set due date to ${payload.dueDate}.` : "Clear the case due date.";
  if ("label" in payload) return `Add open checklist item: ${payload.label}`;
  if ("recipient" in payload) return `Channel: ${payload.channel}\nRecipient: ${payload.recipient}\nSubject: ${payload.subject}\n\n${payload.body}`;
  if ("runAt" in payload) return `First run at ${payload.runAt}${payload.recurrence ? `\nRepeat every ${payload.recurrence.everyDays} day${payload.recurrence.everyDays === 1 ? "" : "s"} at this UTC time until ${payload.recurrence.until}.\nApprove this recurring permission once; changes and resuming paused work need new approval.${payload.replacesScheduleId ? `\nReplace permission ${payload.replacesScheduleId}.` : ""}` : " (one time)."}\nQuestion: ${payload.question}\nInspect this case only and save findings in this conversation. No external message is authorised.`;
  return "Unsupported proposal";
}
