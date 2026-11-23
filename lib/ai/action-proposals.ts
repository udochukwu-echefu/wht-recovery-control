import type { assistantActionProposals } from "@/db/schema";
import { hashStructuredInput } from "./service";
import { validateActionPayload, type ActionProposalPreview, type AssistantActionType } from "./action-contracts";

export async function proposalPreview(row: typeof assistantActionProposals.$inferSelect): Promise<ActionProposalPreview> {
  const stored = JSON.parse(row.payloadJson) as Record<string, unknown>;
  // Keep pending case-note proposals created before the action expansion readable.
  const customer = typeof stored.customer === "string" ? stored.customer : row.caseId;
  const { customer: _customer, ...effects } = stored;
  void _customer;
  const payload = validateActionPayload(row.actionType, effects, false);
  const sourceLabels = JSON.parse(row.sourceLabelsJson) as string[];
  const previewHash = await hashStructuredInput({ id: row.id, workspaceId: row.workspaceId, clientId: row.clientId, caseId: row.caseId, caseUpdatedAt: row.caseUpdatedAt, actionType: row.actionType, payloadJson: row.payloadJson, sourceLabelsJson: row.sourceLabelsJson });
  return { id: row.id, caseId: row.caseId, caseUpdatedAt: row.caseUpdatedAt, customer, actionType: row.actionType as AssistantActionType, payload, sourceLabels, status: row.status as ActionProposalPreview["status"], previewHash, reviewedAt: row.reviewedAt };
}
