import { recoveryCaseStages } from "../case-stage-policy.ts";
import { validateActionPayload, type PreparedAction, type AssistantActionType } from "./action-contracts.ts";

export const proposalToolActions: Record<string, AssistantActionType> = {
  propose_case_note: "case_note",
  propose_case_assignment: "case_assignment",
  propose_case_priority: "case_priority",
  propose_case_due_date: "case_due_date",
  propose_case_checklist: "case_checklist",
  propose_communication_draft: "communication_draft",
  propose_scheduled_followup: "schedule_followup",
};

const proposalFields = {
  propose_case_assignment: { ownerId: { type: "string", description: "An active workspace member ID." } },
  propose_case_priority: { priority: { type: "string", enum: ["low", "standard", "high", "critical"] } },
  propose_case_due_date: { dueDate: { type: ["string", "null"], description: "YYYY-MM-DD, or null to clear the due date." } },
  propose_case_checklist: { label: { type: "string", description: "Exact label of a new open checklist item." } },
  propose_communication_draft: { channel: { type: "string", enum: ["email", "letter"] }, recipient: { type: "string" }, subject: { type: "string" }, body: { type: "string", description: "Exact draft text. It will never be sent by the assistant." } },
  propose_scheduled_followup: { runAt: { type: "string", description: "ISO date and time with timezone, within 90 days. Ask the user for missing timing." }, question: { type: "string", description: "Exact question for a read-only follow-up on this case. Findings stay in this conversation." }, recurrence: { type: "object", description: "Only when the user explicitly requests recurring work. Approval authorises this scope and cadence until expiry; pausing revokes execution until reapproved.", properties: { everyDays: { type: "integer", minimum: 1, maximum: 30 }, until: { type: "string", description: "Permission expiry timestamp with timezone, within 90 days." } }, required: ["everyDays", "until"], additionalProperties: false } },
};

export const portfolioAgentTools = [
  {
    name: "portfolio_summary",
    label: "Inspect portfolio totals",
    description: "Read current case counts and expected WHT totals by stage for the active client.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_workspace_members",
    label: "Inspect available case owners",
    description: "Read up to 50 active case owners in the current workspace, with IDs, names and roles.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_cases",
    label: "Search recovery cases",
    description: "Find current cases by customer, invoice reference, or case ID. Optionally filter by stage. Returns at most 10 cases.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Customer, invoice reference, or case ID; omit to list recent cases." },
        stage: { type: "string", enum: [...recoveryCaseStages] },
      },
      additionalProperties: false,
    },
  },
  ...(["get_case", "get_case_evidence", "get_case_checks"] as const).map((name) => ({
    name,
    label: name === "get_case" ? "Inspect case details" : name === "get_case_evidence" ? "Inspect case evidence" : "Inspect deterministic checks",
    description: name === "get_case"
      ? "Read the current facts and next action for one case returned by search_cases."
      : name === "get_case_evidence"
        ? "Read evidence document metadata linked to one case. Does not read document contents or change evidence."
        : "Read the latest recorded deterministic match result and conflicts for one case.",
    parameters: {
      type: "object",
      properties: { caseId: { type: "string" } },
      required: ["caseId"],
      additionalProperties: false,
    },
  })),
  {
    name: "propose_case_note",
    label: "Prepare case note for review",
    description: "Propose an exact note for a case already inspected with get_case. This only prepares a proposal; a practitioner must approve before a note is saved. Use only when the user asks to prepare a follow-up or case note.",
    parameters: {
      type: "object",
      properties: { caseId: { type: "string" }, note: { type: "string", description: "A concise, factual case note for practitioner review." } },
      required: ["caseId", "note"],
      additionalProperties: false,
    },
  },
  ...Object.entries(proposalFields).map(([name, properties]) => ({
    name,
    label: `Prepare ${proposalToolActions[name].replaceAll("_", " ")} for review`,
    description: `Prepare an exact ${proposalToolActions[name].replaceAll("_", " ")} proposal for a case inspected with get_case. Use only on an explicit user request. Human approval is required before any effect. No status changes, tax decisions or external delivery.`,
    parameters: { type: "object", properties: { caseId: { type: "string" }, ...properties }, required: ["caseId", ...Object.keys(properties).filter((key) => key !== "recurrence")], additionalProperties: false },
  })),
] as const;

export type PortfolioAgentToolResult = {
  data: Record<string, unknown>;
  sourceLabels: string[];
  detail: string;
  proposal?: PreparedAction;
};

function objectArguments(raw: string): Record<string, unknown> {
  let value: unknown;
  try { value = JSON.parse(raw || "{}"); }
  catch { throw new Error("Tool arguments must be valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tool arguments must be an object.");
  return value as Record<string, unknown>;
}

export function parsePortfolioToolArguments(name: string, raw: string) {
  const tool = portfolioAgentTools.find((item) => item.name === name);
  if (!tool) throw new Error("The requested tool is unavailable.");
  const args = objectArguments(raw);
  const proposedFields = name in proposalFields ? Object.keys(proposalFields[name as keyof typeof proposalFields]) : [];
  const allowed = name === "search_cases" ? ["query", "stage"] : name === "portfolio_summary" || name === "list_workspace_members" ? [] : name === "propose_case_note" ? ["caseId", "note"] : ["caseId", ...proposedFields];
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new Error("Tool arguments contain an unsupported field.");
  if (name === "search_cases") {
    if (args.query !== undefined && (typeof args.query !== "string" || args.query.length > 80)) throw new Error("Search query is invalid.");
    if (args.stage !== undefined && (typeof args.stage !== "string" || !recoveryCaseStages.includes(args.stage as (typeof recoveryCaseStages)[number]))) throw new Error("Case stage is invalid.");
    return { query: typeof args.query === "string" ? args.query.trim().replace(/[%_]/g, "") : "", stage: args.stage as string | undefined };
  }
  if (name !== "portfolio_summary" && name !== "list_workspace_members") {
    if (typeof args.caseId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(args.caseId)) throw new Error("Case ID is invalid.");
    if (name === "propose_case_note") {
      if (typeof args.note !== "string" || args.note.trim().length < 12 || args.note.trim().length > 700) throw new Error("Proposed note must contain 12 to 700 characters.");
      return { caseId: args.caseId, note: args.note.trim() };
    }
    if (proposalToolActions[name]) {
      const { caseId, ...payload } = args;
      if (name === "propose_case_assignment") {
        if (typeof args.ownerId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(args.ownerId)) throw new Error("Case owner ID is invalid.");
        return { caseId, ownerId: args.ownerId };
      }
      return { caseId, ...validateActionPayload(proposalToolActions[name], payload) };
    }
    return { caseId: args.caseId };
  }
  return {};
}
