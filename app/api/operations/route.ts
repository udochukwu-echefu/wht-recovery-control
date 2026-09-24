import { and, desc, eq } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { caseChecklistItems, caseNotes, communicationDrafts, recoveryCases } from "@/db/schema";
import { stageForRecordedOutcome, type CaseOutcomeType } from "@/lib/case-stage-policy";
import { apiError, auditStatement, requireContext } from "@/lib/auth";
import { getActiveRuleSet } from "@/lib/rules";

export const runtime = "edge";

const actions = new Set(["assign", "note", "checklist", "approve-draft", "record-correspondence", "record-outcome"]);

export async function GET(request: Request) {
  try {
    const context = await requireContext(request);
    const caseId = new URL(request.url).searchParams.get("caseId")?.trim() ?? "";
    if (!caseId) return Response.json({ error: "caseId is required." }, { status: 400 });
    const recoveryCase = (await getDb().select({ id: recoveryCases.id }).from(recoveryCases).where(and(eq(recoveryCases.id, caseId), eq(recoveryCases.workspaceId, context.workspace.id), eq(recoveryCases.clientId, context.clientId))).limit(1))[0];
    if (!recoveryCase) return Response.json({ error: "Case not found." }, { status: 404 });
    const [notes, checklist, drafts] = await Promise.all([
      getDb().select().from(caseNotes).where(and(eq(caseNotes.workspaceId, context.workspace.id), eq(caseNotes.caseId, caseId))).orderBy(desc(caseNotes.createdAt)).limit(100),
      getDb().select().from(caseChecklistItems).where(and(eq(caseChecklistItems.workspaceId, context.workspace.id), eq(caseChecklistItems.caseId, caseId))).limit(100),
      getDb().select().from(communicationDrafts).where(and(eq(communicationDrafts.workspaceId, context.workspace.id), eq(communicationDrafts.caseId, caseId))).orderBy(desc(communicationDrafts.createdAt)).limit(50),
    ]);
    return Response.json({ notes, checklist, drafts });
  } catch (error) {
    return apiError(error, "Case operations could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireContext(request, ["admin", "practitioner", "reviewer", "analyst"]);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const caseId = String(body.caseId ?? "").trim();
    if (!actions.has(action) || !caseId) return Response.json({ error: "A supported action and caseId are required." }, { status: 400 });
    const recoveryCase = (await getDb().select().from(recoveryCases).where(and(eq(recoveryCases.id, caseId), eq(recoveryCases.workspaceId, context.workspace.id), eq(recoveryCases.clientId, context.clientId))).limit(1))[0];
    if (!recoveryCase) return Response.json({ error: "Case not found." }, { status: 404 });
    const d1 = getD1();
    const now = new Date().toISOString();

    if (action === "assign") {
      const ownerId = String(body.ownerId ?? "").trim();
      const priority = String(body.priority ?? "standard").trim();
      if (!ownerId || !["low", "standard", "high", "critical"].includes(priority)) return Response.json({ error: "An active workspace owner and valid priority are required." }, { status: 400 });
      const owner = await d1.prepare("SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ? AND status = 'active' LIMIT 1").bind(context.workspace.id, ownerId).first<{ role: string }>();
      if (!owner) return Response.json({ error: "The selected owner is not an active member of this workspace." }, { status: 400 });
      const ownerRole = owner.role;
      await d1.batch([
        auditStatement(context, { caseId, eventType: "CASE_ASSIGNED", detail: { before: { ownerId: recoveryCase.assignedOwnerId, ownerRole: recoveryCase.ownerRole, priority: recoveryCase.priority }, after: { ownerId, ownerRole, priority } } }),
        d1.prepare("UPDATE recovery_cases SET assigned_owner_id = ?, owner_role = ?, priority = ?, due_date = ?, escalation_date = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND client_id = ?")
          .bind(ownerId, ownerRole, priority, body.dueDate ? String(body.dueDate) : null, body.escalationDate ? String(body.escalationDate) : null, now, caseId, context.workspace.id, context.clientId),
      ]);
      return Response.json({ caseId, ownerId, ownerRole, priority });
    }

    if (action === "note") {
      const note = String(body.note ?? "").trim();
      if (note.length < 2 || note.length > 4_000) return Response.json({ error: "Note must contain 2 to 4,000 characters." }, { status: 400 });
      const id = crypto.randomUUID();
      await d1.batch([
        d1.prepare("INSERT INTO case_notes (id, workspace_id, case_id, body, created_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, context.workspace.id, caseId, note, context.user.id, now),
        auditStatement(context, { caseId, eventType: "CASE_NOTE_ADDED", detail: { noteId: id } }),
      ]);
      return Response.json({ id, createdAt: now }, { status: 201 });
    }

    if (action === "checklist") {
      const label = String(body.label ?? "").trim();
      if (label.length < 2 || label.length > 180) return Response.json({ error: "Checklist label must contain 2 to 180 characters." }, { status: 400 });
      const id = crypto.randomUUID();
      await d1.batch([
        d1.prepare("INSERT INTO case_checklist_items (id, workspace_id, case_id, label, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)").bind(id, context.workspace.id, caseId, label, now),
        auditStatement(context, { caseId, eventType: "CHECKLIST_ITEM_ADDED", detail: { checklistItemId: id, label } }),
      ]);
      return Response.json({ id, label, status: "open" }, { status: 201 });
    }

    if (action === "approve-draft") {
      if (context.workspace.role === "analyst") return Response.json({ error: "Draft approval requires a reviewer, practitioner or administrator." }, { status: 403 });
      const draftId = String(body.draftId ?? "").trim();
      const note = String(body.note ?? "").trim();
      if (!draftId || note.length < 8) return Response.json({ error: "Draft and approval note are required." }, { status: 400 });
      const approvalResults = await d1.batch([
        d1.prepare("UPDATE communication_drafts SET status = 'approved', approved_at = ?, approved_by_user_id = ? WHERE id = ? AND case_id = ? AND workspace_id = ? AND status = 'generated'")
          .bind(now, context.user.id, draftId, caseId, context.workspace.id),
        d1.prepare(`INSERT INTO audit_events (id, workspace_id, case_id, document_id, event_type, actor, actor_user_id, actor_display_name, actor_role, detail_json, created_at)
          SELECT ?, ?, ?, NULL, 'COMMUNICATION_DRAFT_APPROVED', 'user', ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM communication_drafts WHERE id = ? AND case_id = ? AND workspace_id = ? AND status = 'approved' AND approved_at = ?)`)
          .bind(crypto.randomUUID(), context.workspace.id, caseId, context.user.id, context.user.displayName, context.workspace.role, JSON.stringify({ draftId, note, noMessageSent: true }), now, draftId, caseId, context.workspace.id, now),
      ]);
      if (!(approvalResults[0].meta.changes ?? 0)) return Response.json({ error: "Generated draft not found or already actioned." }, { status: 409 });
      return Response.json({ draftId, status: "approved", approvedAt: now });
    }

    if (action === "record-correspondence") {
      const channel = String(body.channel ?? "email").trim();
      const eventType = String(body.eventType ?? "sent_externally").trim();
      const occurredAt = String(body.occurredAt ?? now).trim();
      const note = String(body.note ?? "").trim();
      if (note.length < 8) return Response.json({ error: "A correspondence note of at least 8 characters is required." }, { status: 400 });
      const id = crypto.randomUUID();
      await d1.batch([
        d1.prepare("INSERT INTO correspondence_events (id, workspace_id, case_id, draft_id, direction, channel, event_type, subject, body, occurred_at, recorded_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(id, context.workspace.id, caseId, body.draftId ? String(body.draftId) : null, String(body.direction ?? "outbound"), channel, eventType, body.subject ? String(body.subject) : null, note, occurredAt, context.user.id, now),
        auditStatement(context, { caseId, eventType: "CORRESPONDENCE_RECORDED", detail: { correspondenceId: id, channel, correspondenceEventType: eventType, occurredAt } }),
        d1.prepare("UPDATE recovery_cases SET last_contact_date = ?, expected_response_date = ?, next_action = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND client_id = ?")
          .bind(occurredAt.slice(0, 10), body.expectedResponseDate ? String(body.expectedResponseDate) : null, body.nextAction ? String(body.nextAction) : recoveryCase.nextAction, now, caseId, context.workspace.id, context.clientId),
      ]);
      return Response.json({ id, occurredAt }, { status: 201 });
    }

    if (!["admin", "practitioner", "reviewer"].includes(context.workspace.role)) return Response.json({ error: "Your role cannot record case outcomes." }, { status: 403 });
    const outcomeType = String(body.outcomeType ?? "").trim();
    const note = String(body.note ?? "").trim();
    const amountKobo = Number(body.amountKobo ?? recoveryCase.expectedWhtKobo);
    if (!new Set(["utilised", "written_off", "non_recoverable", "closed_no_value"]).has(outcomeType) || note.length < 10 || !Number.isInteger(amountKobo) || amountKobo < 0 || amountKobo > recoveryCase.expectedWhtKobo) return Response.json({ error: "Outcome, amount within the case balance and decision note of at least 10 characters are required." }, { status: 400 });
    if (outcomeType === "utilised" && recoveryCase.stage !== "recognised") return Response.json({ error: "Only a recognised credit can be recorded as utilised." }, { status: 409 });
    if (outcomeType === "utilised" && !body.evidenceDocumentId) return Response.json({ error: "Utilisation evidence is required." }, { status: 400 });
    if (outcomeType === "utilised" && amountKobo !== recoveryCase.expectedWhtKobo) return Response.json({ error: "Partial utilisation is not supported yet; the utilisation amount must equal the recognised case balance." }, { status: 409 });
    if (["written_off", "non_recoverable"].includes(outcomeType) && amountKobo !== recoveryCase.expectedWhtKobo) return Response.json({ error: "Partial terminal outcomes are not supported yet; the outcome amount must equal the full case balance." }, { status: 409 });
    if (outcomeType === "closed_no_value" && amountKobo !== 0) return Response.json({ error: "A closed-no-value outcome must record a zero amount." }, { status: 400 });
    if (outcomeType === "written_off" && context.workspace.role === "reviewer") return Response.json({ error: "Write-off requires practitioner or administrator approval." }, { status: 403 });
    const evidenceDocumentId = body.evidenceDocumentId ? String(body.evidenceDocumentId).trim() : "";
    if (evidenceDocumentId) {
      const evidence = await d1.prepare("SELECT id FROM evidence_documents WHERE id = ? AND workspace_id = ? AND client_id = ? AND deleted_at IS NULL LIMIT 1").bind(evidenceDocumentId, context.workspace.id, context.clientId).first();
      if (!evidence) return Response.json({ error: "Outcome evidence was not found in the active client workspace." }, { status: 400 });
    }
    const effectiveDate = String(body.effectiveDate ?? now.slice(0, 10));
    const parsedDate = new Date(`${effectiveDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== effectiveDate) return Response.json({ error: "Effective date must be a valid calendar date." }, { status: 400 });
    const rules = await getActiveRuleSet(context, recoveryCase.businessDate ?? undefined);
    const stage = stageForRecordedOutcome(recoveryCase.stage, outcomeType as CaseOutcomeType);
    const id = crypto.randomUUID();
    await d1.batch([
      d1.prepare("INSERT INTO case_outcomes (id, workspace_id, case_id, outcome_type, amount_kobo, effective_date, reviewer_user_id, approver_user_id, evidence_document_id, decision_note, rule_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, context.workspace.id, caseId, outcomeType, amountKobo, effectiveDate, context.user.id, context.workspace.role === "reviewer" ? null : context.user.id, evidenceDocumentId || null, note, rules.version, now),
      auditStatement(context, { caseId, documentId: evidenceDocumentId || null, eventType: "CASE_OUTCOME_RECORDED", detail: { outcomeId: id, outcomeType, amountKobo, note, ruleVersion: rules.version } }),
      d1.prepare("UPDATE recovery_cases SET stage = ?, next_action = NULL, updated_at = ? WHERE id = ? AND workspace_id = ? AND client_id = ?").bind(stage, now, caseId, context.workspace.id, context.clientId),
    ]);
    return Response.json({ id, caseId, outcomeType, stage, effectiveDate });
  } catch (error) {
    return apiError(error, "The case operation could not be completed.");
  }
}
