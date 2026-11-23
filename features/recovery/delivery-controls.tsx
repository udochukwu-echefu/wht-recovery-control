"use client";

import {useCallback,useEffect,useState} from "react";
import type {DeliveryPreview} from "@/lib/communications/delivery";
import {CustomSelect} from "./custom-select";
import {readControlResponse} from "./assistant-control-client";

type Draft = {id:string;caseId:string;subject:string;recipient:string;channel:string};
type Page = {deliveries:DeliveryPreview[];drafts:Draft[];canReview:boolean;ready:boolean;sender:string|null;nextCursor:string|null};

function DeliveryPermissionCard({delivery,canReview,ready,onOpenCase,onReviewed}:{delivery:DeliveryPreview;canReview:boolean;ready:boolean;onOpenCase:(id:string)=>void;onReviewed:()=>void}) {
  const [note,setNote] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const review = async(action:"approve"|"reject") => {
    if(note.trim().length<8) {setError("Add a review note of at least 8 characters.");return;}
    setBusy(true);setError("");
    try {await fetch("/api/assistant/deliveries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,deliveryId:delivery.id,previewHash:delivery.previewHash,note})}).then(readControlResponse);onReviewed();}
    catch(failure) {setError(failure instanceof Error ? failure.message : "Delivery decision failed.");} finally {setBusy(false);}
  };
  return <article className="assistant-permission-card">
    <div className="overview-chat-proposal-head"><strong>Email permission · {delivery.caseId}</strong><span>{delivery.status === "accepted" ? "Accepted by Resend" : delivery.status}</span></div>
    <p>From: {delivery.fromAddress}<br/>To: {delivery.toAddress}<br/>Subject: {delivery.subject}</p><pre className="assistant-message-preview">{delivery.body}</pre>
    <small>Approval sends this exact email once and records acceptance. Provider acceptance does not confirm that the recipient received it.</small>
    <div className="overview-chat-message-actions"><button type="button" onClick={()=>onOpenCase(delivery.caseId)}>Review case evidence</button></div>
    {delivery.status === "pending" && canReview && <><label htmlFor={`email-review-${delivery.id}`}>Review note</label><textarea id={`email-review-${delivery.id}`} value={note} maxLength={1000} disabled={busy} onChange={(event)=>setNote(event.target.value)} /><div className="overview-chat-message-actions"><button type="button" disabled={busy || !ready} onClick={()=>void review("approve")}>Approve and send exact email</button><button type="button" disabled={busy} onClick={()=>void review("reject")}>Reject send</button></div></>}
    {delivery.errorMessage && <p>{delivery.errorMessage}</p>}{delivery.providerMessageId && <small>Resend message: {delivery.providerMessageId}</small>}{delivery.reviewerNote && <p>Review: {delivery.reviewerNote}</p>}{error && <p role="alert">{error}</p>}
  </article>;
}

export function DeliveryControls({onOpenCase,onActionApplied}: {onOpenCase:(id:string)=>void;onActionApplied?:()=>void}) {
  const [page,setPage] = useState<Page>({deliveries:[],drafts:[],canReview:false,ready:false,sender:null,nextCursor:null});
  const [draftId,setDraftId] = useState("");
  const [recipient,setRecipient] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const load = useCallback(async(signal?:AbortSignal)=>{const result=await fetch("/api/assistant/deliveries",{signal}).then(readControlResponse<Page>);if(!signal?.aborted) {setPage(result);setError("");}},[]);
  useEffect(()=>{const controller=new AbortController();void Promise.resolve().then(()=>load(controller.signal)).catch((failure:unknown)=>{if(!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Email permissions could not be loaded.");});return ()=>controller.abort();},[load]);
  const perform = async(operation:()=>Promise<void>) => {setBusy(true);setError("");try{await operation();}catch(failure){setError(failure instanceof Error ? failure.message : "Email permission failed.");}finally{setBusy(false);}};
  return <section className="assistant-permission-section" aria-label="External email permissions">
    <div className="section-heading"><div><h3>External email permissions</h3><p>Approve a draft first, then separately approve its exact sender, recipient and message.</p></div><button className="secondary-button" type="button" disabled={busy} onClick={()=>void perform(()=>load())}>Refresh emails</button></div>
    {!page.ready && <p>Sending is disabled until an administrator configures Resend and verifies the sender{page.sender ? ` (${page.sender})` : ""}.</p>}
    {page.canReview && <div className="assistant-permission-fields"><div><label htmlFor="email-draft-choice">Approved email draft</label><CustomSelect id="email-draft-choice" value={draftId} options={[{value:"",label:"Choose an approved draft"},...page.drafts.filter((draft)=>draft.channel !== "letter").map((draft)=>({value:draft.id,label:`${draft.caseId} · ${draft.subject}`}))]} ariaLabel="Approved email draft" disabled={busy || !page.ready} onChange={(id)=>{setDraftId(id);setRecipient(page.drafts.find((draft)=>draft.id === id)?.recipient ?? "");}} /></div>
      <label>Recipient<input type="email" value={recipient} disabled={busy || !page.ready} onChange={(event)=>setRecipient(event.target.value)} /></label>
      <button className="secondary-button" type="button" disabled={busy || !page.ready || !draftId || !recipient} onClick={()=>void perform(async()=>{await fetch("/api/assistant/deliveries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"prepare",draftId,recipient})}).then(readControlResponse);setDraftId("");setRecipient("");await load();})}>Prepare send permission</button>
    </div>}
    {page.deliveries.map((delivery)=><DeliveryPermissionCard key={`${delivery.id}:${delivery.status}`} delivery={delivery} canReview={page.canReview} ready={page.ready} onOpenCase={onOpenCase} onReviewed={()=>{void perform(()=>load());onActionApplied?.();}} />)}
    {page.deliveries.length === 0 && <p>No email send permissions.</p>}{error && <p role="alert">{error}</p>}
    {page.nextCursor && <button type="button" className="secondary-button" disabled={busy} onClick={()=>void perform(async()=>{const more=await fetch(`/api/assistant/deliveries?cursor=${encodeURIComponent(page.nextCursor!)}`).then(readControlResponse<Page>);setPage((current)=>({...more,deliveries:[...current.deliveries,...more.deliveries]}));})}>Load older email permissions</button>}
  </section>;
}
