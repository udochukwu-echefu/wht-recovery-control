import { env } from "cloudflare:workers";
import type { communicationDeliveries } from "@/db/schema";
import { getD1 } from "@/db";
import { ApiError, type RequestContext } from "@/lib/auth";
import { hashStructuredInput } from "@/lib/ai/service";

export type Delivery = typeof communicationDeliveries.$inferSelect;
export type DeliveryPreview = Delivery & { previewHash:string };

export function emailAddress(value: unknown) {
  if (typeof value !== "string" || value.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value)) throw new ApiError(422,"Enter one valid email address without a display name or additional recipients.");
  return value;
}

export function deliveryConfig() {
  const sender = env.EMAIL_FROM?.trim() || "";
  let valid = false;
  try { emailAddress(sender); valid = true; } catch { /* No sender is configured yet. */ }
  return { sender,ready:env.EMAIL_DELIVERY_ENABLED === "true" && valid && Boolean(env.RESEND_API_KEY?.trim()) };
}

export async function deliveryPreview(row:Delivery):Promise<DeliveryPreview> {
  const {id,workspaceId,clientId,caseId,draftId,draftVersion,caseUpdatedAt,fromAddress,toAddress,subject,body} = row;
  return {...row,previewHash:await hashStructuredInput({id,workspaceId,clientId,caseId,draftId,draftVersion,caseUpdatedAt,fromAddress,toAddress,subject,body})};
}

export function deliveryAudit(d1:D1Database,row:Delivery,context:RequestContext,event:string,detail:unknown,now:string,status:string) {
  return d1.prepare(`INSERT INTO audit_events (id,workspace_id,case_id,event_type,actor,actor_user_id,actor_display_name,actor_role,detail_json,created_at)
    SELECT ?,workspace_id,case_id,?,'user',?,?,?,?,? FROM communication_deliveries WHERE id=? AND status=? AND decision_id=?`)
    .bind(crypto.randomUUID(),event,context.user.id,context.user.displayName,context.workspace.role,JSON.stringify(detail),now,row.id,status,row.decisionId);
}

const escapeHtml = (value:string) => value.replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]!);

/** Called only after the HTTP human decision has atomically consumed permission. */
export async function sendApprovedDelivery(row:Delivery,context:RequestContext) {
  const d1 = getD1();
  const config = deliveryConfig();
  const now = new Date().toISOString();
  const eligible = await d1.prepare(`SELECT cd.id FROM communication_deliveries cd JOIN recovery_cases rc ON rc.id=cd.case_id AND rc.workspace_id=cd.workspace_id AND rc.client_id=cd.client_id AND rc.deleted_at IS NULL AND rc.updated_at=cd.case_updated_at
    JOIN clients c ON c.id=cd.client_id AND c.workspace_id=cd.workspace_id AND c.status='active'
    JOIN communication_drafts d ON d.id=cd.draft_id AND d.workspace_id=cd.workspace_id AND d.case_id=cd.case_id AND d.version=cd.draft_version AND d.subject=cd.subject AND d.body=cd.body AND d.approved_at IS NOT NULL AND d.status IN ('approved','copied')
    JOIN users u ON u.id=cd.reviewed_by_user_id AND u.status='active' JOIN workspace_memberships m ON m.user_id=u.id AND m.workspace_id=cd.workspace_id AND m.status='active' AND m.role IN ('admin','practitioner','reviewer')
    WHERE cd.id=? AND cd.status='sending' AND cd.decision_id=? AND cd.reviewed_by_user_id=?`).bind(row.id,row.decisionId,context.user.id).first();
  if (!eligible || !config.ready || config.sender !== row.fromAddress) {
    await d1.batch([
      d1.prepare("UPDATE communication_deliveries SET status='failed',error_message='Access, draft, case or sending configuration changed before delivery.',completed_at=? WHERE id=? AND status='sending' AND decision_id=?").bind(now,row.id,row.decisionId),
      deliveryAudit(d1,row,context,"EMAIL_DELIVERY_BLOCKED",{deliveryId:row.id,noMessageSent:true},now,"failed"),
    ]);
    return {status:"failed"};
  }
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),15_000);
  let acceptedId:string | undefined;
  try {
    const response = await fetch("https://api.resend.com/emails",{
      method:"POST",signal:controller.signal,headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":`wht-email/${row.id}`},
      body:JSON.stringify({from:row.fromAddress,to:[row.toAddress],subject:row.subject,text:row.body,html:`<div style="white-space:pre-wrap">${escapeHtml(row.body)}</div>`}),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error("Resend did not confirm acceptance.") as Error & {definitelyRejected?:boolean};
      // A payload/auth rejection precedes acceptance. Conflicts, timeouts and
      // server errors remain uncertain and are never retried automatically.
      error.definitelyRejected = [400,401,403,422].includes(response.status);
      throw error;
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Email acceptance is uncertain.");
    let content = "";
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes>4096) {await reader.cancel();throw new Error("Email acceptance is uncertain.");}
        content += decoder.decode(part.value,{stream:true});
      }
      content += decoder.decode();
    } finally { reader.releaseLock(); }
    const result = JSON.parse(content) as {id?:unknown};
    if (typeof result.id !== "string" || !result.id || result.id.length > 250) throw new Error("Email acceptance is uncertain.");
    acceptedId = result.id;
    const completed = new Date().toISOString();
    const recorded = await d1.batch([
      d1.prepare("UPDATE communication_deliveries SET status='accepted',provider_message_id=?,completed_at=? WHERE id=? AND status='sending' AND decision_id=?").bind(acceptedId,completed,row.id,row.decisionId),
      d1.prepare(`INSERT INTO correspondence_events (id,workspace_id,case_id,draft_id,direction,channel,event_type,subject,body,occurred_at,recorded_by_user_id,created_at)
        SELECT id,workspace_id,case_id,draft_id,'outbound','email','accepted_by_provider',subject,body,?,?,? FROM communication_deliveries WHERE id=? AND status='accepted'`).bind(completed,context.user.id,completed,row.id),
      deliveryAudit(d1,row,context,"EMAIL_DELIVERY_ACCEPTED",{deliveryId:row.id,providerMessageId:acceptedId,recipient:row.toAddress,deliveryConfirmed:false},completed,"accepted"),
      d1.prepare(`UPDATE recovery_cases SET updated_at=MAX(?,strftime('%Y-%m-%dT%H:%M:%fZ',updated_at,'+0.001 seconds')) WHERE id=? AND workspace_id=? AND client_id=? AND EXISTS (SELECT 1 FROM communication_deliveries WHERE id=? AND status='accepted')`).bind(completed,row.caseId,row.workspaceId,row.clientId,row.id),
    ]);
    if (!recorded[0].meta.changes) throw new Error("Delivery acceptance could not be recorded against its original permission.");
    return {status:"accepted",providerMessageId:acceptedId};
  } catch (error) {
    const rejected = error && typeof error === "object" && "definitelyRejected" in error && error.definitelyRejected === true;
    const status = !acceptedId && rejected ? "failed" : "unknown";
    const message = status === "failed" ? "The provider rejected this email. A new send requires fresh permission." : "The provider may have accepted this email. Check provider logs before any further send; this permission will not be retried.";
    try {
      await d1.batch([
        d1.prepare("UPDATE communication_deliveries SET status=?,provider_message_id=?,error_message=?,completed_at=? WHERE id=? AND status='sending' AND decision_id=?").bind(status,acceptedId ?? null,message,new Date().toISOString(),row.id,row.decisionId),
        deliveryAudit(d1,row,context,`EMAIL_DELIVERY_${status.toUpperCase()}`,{deliveryId:row.id,providerMessageId:acceptedId ?? null,message},new Date().toISOString(),status),
      ]);
    } catch { /* A persisted sending claim is recovered as uncertain, never resent. */ }
    return {status,message};
  } finally { clearTimeout(timer); }
}

/** Recovery only marks interrupted claims uncertain. It never sends email. */
export async function recoverInterruptedDeliveries(d1:D1Database,clock=Date.now()) {
  const now = new Date(clock).toISOString();
  const rows = await d1.prepare("SELECT id FROM communication_deliveries WHERE status='sending' AND attempted_at < ? ORDER BY attempted_at LIMIT 10").bind(new Date(clock-120_000).toISOString()).all<{id:string}>();
  for (const row of rows.results) await d1.batch([
    d1.prepare("UPDATE communication_deliveries SET status='unknown',error_message='Delivery was interrupted. Check provider logs; this permission will not be retried.',completed_at=? WHERE id=? AND status='sending'").bind(now,row.id),
    d1.prepare(`INSERT OR IGNORE INTO audit_events (id,workspace_id,case_id,event_type,actor,detail_json,created_at)
      SELECT id || ':interrupted',workspace_id,case_id,'EMAIL_DELIVERY_UNKNOWN','system',?,? FROM communication_deliveries WHERE id=? AND status='unknown'`).bind(JSON.stringify({deliveryId:row.id,noAutomaticRetry:true}),now,row.id),
  ]);
}
