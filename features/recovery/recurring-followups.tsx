"use client";

import {useCallback,useEffect,useState} from "react";
import type {ActionProposalPreview} from "@/lib/ai/action-contracts";
import type {RecurringSchedule} from "@/lib/ai/recurring-followups";
import {ActionProposalCard} from "./action-proposal";
import {readControlResponse} from "./assistant-control-client";

type Schedule = RecurringSchedule & {canControl:boolean};
type Page = {schedules:Schedule[];canReview:boolean;nextCursor:string|null};
type ScheduleHistory = {events:Array<{eventType:string;createdAt:string;payload:unknown}>};
const watInput = (date:number) => new Date(date+3_600_000).toISOString().slice(0,16);
const watTimestamp = (value:string) => `${value}:00+01:00`;

function RecurringPermissionCard({schedule,canReview,onOpenCase,onChanged}: {schedule:Schedule;canReview:boolean;onOpenCase:(id:string)=>void;onChanged:()=>void}) {
  const [note,setNote] = useState("");
  const [question,setQuestion] = useState(schedule.question);
  const [days,setDays] = useState(schedule.everyDays);
  const [start,setStart] = useState(()=>watInput(Math.max(Date.now()+3_600_000,Date.parse(schedule.nextRunAt ?? schedule.startsAt))));
  const [until,setUntil] = useState(()=>watInput(Date.parse(schedule.endsAt)));
  const [proposal,setProposal] = useState<ActionProposalPreview|null>(null);
  const [history,setHistory] = useState<ScheduleHistory|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const perform = async (operation:()=>Promise<void>) => {setBusy(true);setError("");try {await operation();} catch(failure) {setError(failure instanceof Error ? failure.message : "Permission could not be updated.");} finally {setBusy(false);}};
  const control = async (action:"pause"|"revoke"|"prepare_change") => {
    if (note.trim().length<8) throw new Error("Add a reason of at least 8 characters.");
    const result = await fetch("/api/assistant/schedules",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({scheduleId:schedule.id,expectedUpdatedAt:schedule.updatedAt,action,note,
      ...(action === "prepare_change" ? {payload:{runAt:watTimestamp(start),question,recurrence:{everyDays:days,until:watTimestamp(until)}}} : {}),
    })}).then(readControlResponse<{proposal?:ActionProposalPreview}>);
    if (result.proposal) setProposal(result.proposal); else onChanged();
  };
  return <article className="assistant-permission-card">
    <div className="overview-chat-proposal-head"><strong>{schedule.caseId}</strong><span>{schedule.status}</span></div>
    <p>{schedule.question}</p>
    <p>Every {schedule.everyDays} day{schedule.everyDays === 1 ? "" : "s"}. Starts {schedule.startsAt}; permission expires {schedule.endsAt}.</p>
    <small>{schedule.nextRunAt ? `Next occurrence: ${schedule.nextRunAt}.` : "No future occurrence is queued."} Results stay in the original conversation. This permission authorises no external messages.</small>
    <div className="overview-chat-message-actions"><button type="button" onClick={()=>onOpenCase(schedule.caseId)}>Review case</button><button type="button" disabled={busy} onClick={()=>void perform(async()=>setHistory(await fetch(`/api/assistant/schedules?id=${encodeURIComponent(schedule.id)}`).then(readControlResponse<ScheduleHistory>)))}>Inspect permission history</button></div>
    {schedule.canControl && schedule.status !== "revoked" && <>
      <label htmlFor={`permission-note-${schedule.id}`}>Reason for this permission decision</label><textarea id={`permission-note-${schedule.id}`} value={note} maxLength={1000} disabled={busy} onChange={(event)=>setNote(event.target.value)} />
      <div className="overview-chat-message-actions">{schedule.status === "active" && <button type="button" disabled={busy} onClick={()=>void perform(()=>control("pause"))}>Pause and stop queued work</button>}<button type="button" disabled={busy} onClick={()=>void perform(()=>control("revoke"))}>Revoke permission</button></div>
    </>}
    {canReview && schedule.status !== "revoked" && <details><summary>{schedule.status === "active" ? "Propose a schedule change" : "Propose resuming with new permission"}</summary>
      <label htmlFor={`permission-question-${schedule.id}`}>Question</label><textarea id={`permission-question-${schedule.id}`} value={question} maxLength={300} disabled={busy} onChange={(event)=>setQuestion(event.target.value)} />
      <div className="assistant-permission-fields"><label>First run (WAT)<input type="datetime-local" value={start} disabled={busy} onChange={(event)=>setStart(event.target.value)} /></label><label>Repeat every days<input type="number" min={1} max={30} value={days} disabled={busy} onChange={(event)=>setDays(Number(event.target.value))} /></label><label>Permission expiry (WAT)<input type="datetime-local" value={until} disabled={busy} onChange={(event)=>setUntil(event.target.value)} /></label></div>
      <p>Preparing a change applies no effects. Approve its exact scope and cadence separately.</p><button className="secondary-button" type="button" disabled={busy} onClick={()=>void perform(()=>control("prepare_change"))}>Prepare for approval</button>
    </details>}
    {proposal && <ActionProposalCard proposal={proposal} canReview={canReview} onOpenCase={onOpenCase} onReviewed={(reviewed)=>{setProposal(reviewed);if(reviewed.status === "approved") onChanged();}} />}
    {history && <div>{history.events.map((event,index)=><details key={index}><summary>{event.eventType.replaceAll("_"," ")} · {event.createdAt}</summary><pre>{JSON.stringify(event.payload,null,2)}</pre></details>)}</div>}
    {error && <p role="alert">{error}</p>}
  </article>;
}

export function RecurringFollowups({onOpenCase,onActionApplied}: {onOpenCase:(id:string)=>void;onActionApplied?:()=>void}) {
  const [page,setPage] = useState<Page>({schedules:[],canReview:false,nextCursor:null});
  const [error,setError] = useState("");
  const load = useCallback(async(signal?:AbortSignal)=>{const result=await fetch("/api/assistant/schedules",{signal}).then(readControlResponse<Page>);if(!signal?.aborted) {setPage(result);setError("");}},[]);
  useEffect(()=>{const controller=new AbortController();void Promise.resolve().then(()=>load(controller.signal)).catch((failure:unknown)=>{if(!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Permissions could not be loaded.");});return ()=>controller.abort();},[load]);
  const refresh = () => {void load().catch((failure:unknown)=>setError(failure instanceof Error ? failure.message : "Permissions could not be loaded."));};
  return <section className="assistant-permission-section" aria-label="Recurring follow-up permissions">
    <div className="section-heading"><div><h3>Recurring follow-up permissions</h3><p>Approve the case, question, cadence and expiry once. Changes and resuming paused work need new approval.</p></div><button className="secondary-button" type="button" onClick={refresh}>Refresh permissions</button></div>
    {error && <p role="alert">{error}</p>}{page.schedules.length === 0 && <p>No recurring permissions. Ask the assistant to prepare a recurring follow-up with a first run, interval and expiry.</p>}
    {page.schedules.map((schedule)=><RecurringPermissionCard key={`${schedule.id}:${schedule.updatedAt}`} schedule={schedule} canReview={page.canReview} onOpenCase={onOpenCase} onChanged={()=>{refresh();onActionApplied?.();}} />)}
    {page.nextCursor && <button type="button" className="secondary-button" onClick={()=>void fetch(`/api/assistant/schedules?cursor=${encodeURIComponent(page.nextCursor!)}`).then(readControlResponse<Page>).then((more)=>setPage((current)=>({...more,schedules:[...current.schedules,...more.schedules]}))).catch((failure:unknown)=>setError(failure instanceof Error ? failure.message : "Permissions could not be loaded."))}>Load older permissions</button>}
  </section>;
}
