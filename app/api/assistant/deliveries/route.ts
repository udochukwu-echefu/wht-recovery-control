import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { communicationDeliveries,communicationDrafts,recoveryCases } from "@/db/schema";
import { ApiError,apiError,enforceRateLimit,requireContext } from "@/lib/auth";
import { assistantApproverRoles } from "@/lib/ai/action-contracts";
import { deliveryAudit,deliveryConfig,deliveryPreview,emailAddress,sendApprovedDelivery } from "@/lib/communications/delivery";

export const runtime = "edge";

export async function GET(request:Request) {
  try {
    const context = await requireContext(request);
    const canReview = (assistantApproverRoles as readonly string[]).includes(context.workspace.role);
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor")?.split("|");
    const id = url.searchParams.get("id");
    const rows = await getDb().select().from(communicationDeliveries).where(and(eq(communicationDeliveries.workspaceId,context.workspace.id),eq(communicationDeliveries.clientId,context.clientId),canReview ? undefined : eq(communicationDeliveries.requestedByUserId,context.user.id),id ? eq(communicationDeliveries.id,id) : undefined,
      cursor?.length === 2 ? or(lt(communicationDeliveries.createdAt,cursor[0]),and(eq(communicationDeliveries.createdAt,cursor[0]),lt(communicationDeliveries.id,cursor[1]))) : undefined,
    )).orderBy(desc(communicationDeliveries.createdAt),desc(communicationDeliveries.id)).limit(51);
    if (id && !rows.length) throw new ApiError(404,"Delivery permission not found in this client workspace.");
    const drafts = canReview ? await getDb().select({id:communicationDrafts.id,caseId:communicationDrafts.caseId,subject:communicationDrafts.subject,sourceSnapshotJson:communicationDrafts.sourceSnapshotJson}).from(communicationDrafts)
      .innerJoin(recoveryCases,and(eq(recoveryCases.id,communicationDrafts.caseId),eq(recoveryCases.workspaceId,communicationDrafts.workspaceId)))
      .where(and(eq(communicationDrafts.workspaceId,context.workspace.id),eq(recoveryCases.clientId,context.clientId),sql`${recoveryCases.deletedAt} IS NULL`,sql`${communicationDrafts.approvedAt} IS NOT NULL`,sql`${communicationDrafts.status} IN ('approved','copied')`,sql`NOT EXISTS (SELECT 1 FROM communication_deliveries cd WHERE cd.draft_id=${communicationDrafts.id} AND cd.status IN ('pending','sending','accepted','unknown'))`))
      .orderBy(desc(communicationDrafts.createdAt)).limit(50) : [];
    const page = rows.slice(0,50);
    const last = page.at(-1);
    const config = deliveryConfig();
    return Response.json({deliveries:await Promise.all(page.map(deliveryPreview)),canReview,ready:config.ready,sender:config.sender || null,
      drafts:drafts.map(({sourceSnapshotJson,...draft})=>{let recipient="";let channel="";try {const snapshot=JSON.parse(sourceSnapshotJson);recipient=typeof snapshot.effects?.recipient === "string" ? snapshot.effects.recipient : "";channel=typeof snapshot.effects?.channel === "string" ? snapshot.effects.channel : "";} catch { /* Legacy drafts may have no channel metadata. */ } return {...draft,recipient,channel};}),
      nextCursor:rows.length>50 && last ? `${last.createdAt}|${last.id}` : null});
  } catch (error) { return apiError(error,"Delivery permissions could not be loaded."); }
}

export async function POST(request:Request) {
  try {
    const context = await requireContext(request,assistantApproverRoles);
    await enforceRateLimit(context,"assistant-email-permission",10,60);
    const body = await request.json() as Record<string,unknown>;
    const action = body.action;
    const d1 = getD1();
    const now = new Date().toISOString();
    const config = deliveryConfig();
    if (action === "prepare") {
      if (!config.ready) throw new ApiError(503,"Email sending is unavailable until an administrator configures a verified sender.");
      const draftId = typeof body.draftId === "string" ? body.draftId : "";
      const recipient = emailAddress(body.recipient);
      const draft = (await getDb().select({draft:communicationDrafts,case:recoveryCases}).from(communicationDrafts).innerJoin(recoveryCases,and(eq(recoveryCases.id,communicationDrafts.caseId),eq(recoveryCases.workspaceId,communicationDrafts.workspaceId)))
        .where(and(eq(communicationDrafts.id,draftId),eq(communicationDrafts.workspaceId,context.workspace.id),eq(recoveryCases.clientId,context.clientId),sql`${recoveryCases.deletedAt} IS NULL`,sql`${communicationDrafts.approvedAt} IS NOT NULL`,sql`${communicationDrafts.status} IN ('approved','copied')`)).limit(1))[0];
      if (!draft) throw new ApiError(404,"An approved draft was not found in this client workspace.");
      let channel = "";
      try { channel = JSON.parse(draft.draft.sourceSnapshotJson).effects?.channel ?? ""; } catch { /* Legacy drafts remain eligible for a separate exact email review. */ }
      if (channel === "letter") throw new ApiError(422,"This is a letter draft. Prepare and approve an email draft before requesting delivery.");
      if (!draft.draft.subject.trim() || draft.draft.subject.length>180 || /[\r\n]/.test(draft.draft.subject) || draft.draft.body.length<12 || draft.draft.body.length>4000) throw new ApiError(422,"The approved draft cannot be sent as an email.");
      const previous = await d1.prepare("SELECT id FROM communication_deliveries WHERE draft_id=? AND status IN ('pending','sending','accepted','unknown')").bind(draftId).first();
      if (previous) throw new ApiError(409,"This draft already has an unresolved or accepted delivery. Review its history before any further send.");
      const id = crypto.randomUUID();
      try {
        await d1.batch([
          d1.prepare(`INSERT INTO communication_deliveries (id,workspace_id,client_id,case_id,draft_id,draft_version,case_updated_at,from_address,to_address,subject,body,requested_by_user_id,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,context.workspace.id,context.clientId,draft.case.id,draftId,draft.draft.version,draft.case.updatedAt,config.sender,recipient,draft.draft.subject,draft.draft.body,context.user.id,now),
          d1.prepare(`INSERT INTO audit_events (id,workspace_id,case_id,event_type,actor,actor_user_id,actor_display_name,actor_role,detail_json,created_at) VALUES (?,?,?,'EMAIL_PERMISSION_PREPARED','user',?,?,?,?,?)`).bind(crypto.randomUUID(),context.workspace.id,draft.case.id,context.user.id,context.user.displayName,context.workspace.role,JSON.stringify({deliveryId:id,draftId,noMessageSent:true}),now),
        ]);
      } catch (error) { if (error instanceof Error && /uq_draft_unresolved|UNIQUE constraint.*draft_id/.test(error.message)) throw new ApiError(409,"This draft already has a delivery permission."); throw error; }
      const row = (await getDb().select().from(communicationDeliveries).where(eq(communicationDeliveries.id,id)).limit(1))[0];
      return Response.json({delivery:await deliveryPreview(row)},{status:201});
    }
    if (action !== "approve" && action !== "reject") throw new ApiError(400,"Choose prepare, approve or reject.");
    const id = typeof body.deliveryId === "string" ? body.deliveryId : "";
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || note.length<8 || note.length>1000) throw new ApiError(400,"A delivery permission and review note of 8 to 1,000 characters are required.");
    const row = (await getDb().select().from(communicationDeliveries).where(and(eq(communicationDeliveries.id,id),eq(communicationDeliveries.workspaceId,context.workspace.id),eq(communicationDeliveries.clientId,context.clientId))).limit(1))[0];
    if (!row) throw new ApiError(404,"Delivery permission not found.");
    if (row.status !== "pending") throw new ApiError(409,"This delivery permission has already been consumed or rejected.");
    const preview = await deliveryPreview(row);
    if (body.previewHash !== preview.previewHash) throw new ApiError(409,"Reload and review the exact sender, recipient and message before deciding.");
    if (action === "approve" && (!config.ready || config.sender !== row.fromAddress)) throw new ApiError(409,"The sending configuration changed. Prepare a fresh delivery permission.");
    const status = action === "approve" ? "sending" : "rejected";
    const decisionId = crypto.randomUUID();
    const decidedRow = {...row,status,decisionId,reviewedByUserId:context.user.id,reviewerNote:note,reviewedAt:now,attemptedAt:action === "approve" ? now : null};
    const results = await d1.batch([
      d1.prepare(`UPDATE communication_deliveries SET status=?,reviewed_by_user_id=?,reviewer_note=?,decision_id=?,reviewed_at=?,attempted_at=? WHERE id=? AND status='pending'
        AND EXISTS (SELECT 1 FROM users u JOIN workspace_memberships m ON m.user_id=u.id AND m.workspace_id=communication_deliveries.workspace_id AND m.status='active' AND m.role IN ('admin','practitioner','reviewer') JOIN clients c ON c.workspace_id=m.workspace_id AND c.id=communication_deliveries.client_id AND c.status='active' WHERE u.id=? AND u.status='active')
        ${action === "approve" ? `AND EXISTS (SELECT 1 FROM recovery_cases rc JOIN communication_drafts d ON d.id=communication_deliveries.draft_id AND d.workspace_id=rc.workspace_id AND d.case_id=rc.id
          WHERE rc.id=communication_deliveries.case_id AND rc.workspace_id=communication_deliveries.workspace_id AND rc.client_id=communication_deliveries.client_id AND rc.deleted_at IS NULL AND rc.updated_at=communication_deliveries.case_updated_at
          AND d.version=communication_deliveries.draft_version AND d.subject=communication_deliveries.subject AND d.body=communication_deliveries.body AND d.approved_at IS NOT NULL AND d.status IN ('approved','copied'))` : ""}`)
        .bind(status,context.user.id,note,decisionId,now,action === "approve" ? now : null,id,context.user.id),
      deliveryAudit(d1,decidedRow,context,action === "approve" ? "EMAIL_SEND_PERMISSION_APPROVED" : "EMAIL_SEND_PERMISSION_REJECTED",{deliveryId:id,previewHash:preview.previewHash,note,exactMessage:{from:row.fromAddress,to:row.toAddress,subject:row.subject,body:row.body},permission:"one send only"},now,status),
    ]);
    if (!results[0].meta.changes) throw new ApiError(409,"The draft, case or access changed. Prepare a fresh delivery permission.");
    if (action === "reject") return Response.json({status:"rejected"});
    return Response.json(await sendApprovedDelivery(decidedRow,context));
  } catch (error) { return apiError(error,"The email permission could not be processed."); }
}
