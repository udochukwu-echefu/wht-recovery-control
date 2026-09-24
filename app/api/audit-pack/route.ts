import { getD1 } from "@/db";
import { apiError, auditStatement, requireContext } from "@/lib/auth";
import { sha256Hex } from "@/lib/storage";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const context = await requireContext(request, ["admin", "practitioner", "reviewer", "analyst"]);
    const body = await request.json() as Record<string, unknown>;
    const caseId = String(body.caseId ?? "").trim();
    if (!caseId) return Response.json({ error: "caseId is required." }, { status: 400 });
    const d1 = getD1();
    const recoveryCase = await d1.prepare("SELECT * FROM recovery_cases WHERE id = ? AND workspace_id = ? AND client_id = ? LIMIT 1").bind(caseId, context.workspace.id, context.clientId).first<Record<string, unknown>>();
    if (!recoveryCase) return Response.json({ error: "Case not found." }, { status: 404 });
    const [sources, documents, fields, matches, applicability, receipts, receiptAllocations, authorityAllocations, outcomes, correspondence, notes, checklist, audit] = await Promise.all([
      d1.prepare("SELECT * FROM case_sources WHERE case_id = ? AND workspace_id = ? ORDER BY created_at").bind(caseId, context.workspace.id).all(),
      d1.prepare("SELECT d.id, d.file_name, d.mime_type, d.size_bytes, d.sha256, d.kind, d.status, d.created_at FROM evidence_documents d JOIN case_sources s ON s.document_id = d.id WHERE s.case_id = ? AND s.workspace_id = ? AND d.client_id = ? UNION SELECT d.id, d.file_name, d.mime_type, d.size_bytes, d.sha256, d.kind, d.status, d.created_at FROM evidence_documents d WHERE d.id = ? AND d.workspace_id = ? AND d.client_id = ?").bind(caseId, context.workspace.id, context.clientId, recoveryCase.source_document_id ?? "", context.workspace.id, context.clientId).all(),
      d1.prepare("SELECT f.* FROM extracted_fields f JOIN evidence_documents d ON d.id = f.document_id WHERE d.workspace_id = ? AND d.client_id = ? AND d.id = ? ORDER BY f.field_name").bind(context.workspace.id, context.clientId, recoveryCase.source_document_id ?? "").all(),
      d1.prepare("SELECT * FROM match_executions WHERE case_id = ? AND workspace_id = ? ORDER BY created_at").bind(caseId, context.workspace.id).all(),
      d1.prepare("SELECT * FROM applicability_reviews WHERE case_id = ? AND workspace_id = ? ORDER BY created_at").bind(caseId, context.workspace.id).all(),
      d1.prepare("SELECT r.* FROM receipt_records r JOIN receipt_allocations a ON a.receipt_id = r.id WHERE a.case_id = ? AND a.workspace_id = ? AND r.client_id = ? ORDER BY r.created_at").bind(caseId, context.workspace.id, context.clientId).all(),
      d1.prepare("SELECT * FROM receipt_allocations WHERE case_id = ? AND workspace_id = ? ORDER BY created_at").bind(caseId, context.workspace.id).all(),
      d1.prepare("SELECT a.*, r.record_reference, r.authority_type, r.credit_status FROM authority_allocations a JOIN authority_records r ON r.id = a.authority_record_id WHERE a.case_id = ? AND a.workspace_id = ? AND r.client_id = ? ORDER BY a.created_at").bind(caseId, context.workspace.id, context.clientId).all(),
      d1.prepare("SELECT * FROM case_outcomes WHERE case_id = ? AND workspace_id = ? ORDER BY created_at").bind(caseId, context.workspace.id).all(),
      d1.prepare("SELECT * FROM correspondence_events WHERE case_id = ? AND workspace_id = ? ORDER BY occurred_at").bind(caseId, context.workspace.id).all(),
      d1.prepare("SELECT id, body, created_by_user_id, created_at FROM case_notes WHERE case_id = ? AND workspace_id = ? AND deleted_at IS NULL ORDER BY created_at").bind(caseId, context.workspace.id).all(),
      d1.prepare("SELECT * FROM case_checklist_items WHERE case_id = ? AND workspace_id = ? ORDER BY created_at").bind(caseId, context.workspace.id).all(),
      d1.prepare("SELECT * FROM audit_events WHERE case_id = ? AND workspace_id = ? ORDER BY created_at, id").bind(caseId, context.workspace.id).all(),
    ]);
    const generatedAt = new Date().toISOString();
    const snapshot = { schemaVersion: "wht-audit-pack.v1", generatedAt, workspace: { id: context.workspace.id, name: context.workspace.name }, case: recoveryCase, sources: sources.results, documents: documents.results, extractedFields: fields.results, applicabilityReviews: applicability.results, deterministicMatches: matches.results, receipts: receipts.results, receiptAllocations: receiptAllocations.results, authorityReconciliation: authorityAllocations.results, outcomes: outcomes.results, correspondence: correspondence.results, notes: notes.results, checklist: checklist.results, auditEvents: audit.results };
    const snapshotJson = JSON.stringify(snapshot, null, 2);
    const snapshotHash = await sha256Hex(new TextEncoder().encode(snapshotJson).buffer);
    const manifest = { fileName: `${caseId.toLowerCase()}-audit-pack.json`, contentType: "application/json", sha256: snapshotHash, evidenceCount: documents.results.length, auditEventCount: audit.results.length };
    const packId = crypto.randomUUID();
    await d1.batch([
      d1.prepare("INSERT INTO audit_packs (id, workspace_id, case_id, format, snapshot_json, manifest_json, generated_by_user_id, generated_at, snapshot_hash, created_at) VALUES (?, ?, ?, 'json', ?, ?, ?, ?, ?, ?)").bind(packId, context.workspace.id, caseId, snapshotJson, JSON.stringify(manifest), context.user.id, generatedAt, snapshotHash, generatedAt),
      auditStatement(context, { caseId, eventType: "AUDIT_PACK_GENERATED", detail: { packId, snapshotHash, manifest } }),
    ]);
    return new Response(snapshotJson, { status: 201, headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${manifest.fileName}"`, "x-audit-pack-id": packId, "x-content-sha256": snapshotHash, "cache-control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "The audit pack could not be generated.");
  }
}
