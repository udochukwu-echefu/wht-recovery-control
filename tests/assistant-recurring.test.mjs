import test from "node:test";
import assert from "node:assert/strict";
import {runtime,call,answer} from "./support/assistant-runtime.mjs";
import {validateActionPayload,actionDescription} from "../lib/ai/action-contracts.ts";
import {dueOccurrence} from "../lib/ai/recurring-followups.ts";

const day = 86_400_000;
const payload = (start = Date.now()+1_000) => ({runAt:new Date(start).toISOString(),question:"Inspect receipt evidence for this case and save findings for review.",recurrence:{everyDays:1,until:new Date(start+7*day).toISOString()}});
const tick = (app,now) => app.fetch("/__test/tick-recurring",{method:"POST",body:{now}});
const schedule = async (app,id) => (await (await app.fetch(`/api/assistant/schedules?id=${id}`,{actor:"reviewer"})).json()).schedule;
const control = (app,row,action,extra={}) => app.fetch("/api/assistant/schedules",{actor:"reviewer",method:"POST",body:{scheduleId:row.id,expectedUpdatedAt:row.updatedAt,action,note:"Reviewed the exact recurring permission.",...extra}});
async function approved(app,effects=payload()) {
  const proposal = await app.propose("schedule_followup",effects);
  const response = await app.review(proposal);
  assert.equal(response.status,200,await response.text());
  return schedule(app,proposal.id);
}
const count = async(app,table) => (await app.db.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;

test("recurring permissions display bounded exact effects and reject hidden or invalid cadence", () => {
  const effects = payload();
  assert.deepEqual(validateActionPayload("schedule_followup",effects),effects);
  assert.match(actionDescription("schedule_followup",effects),/Approve this recurring permission once/);
  assert.match(actionDescription("schedule_followup",effects),/No external message is authorised/);
  for(const everyDays of [0,31,1.5,"1"]) assert.throws(()=>validateActionPayload("schedule_followup",{...effects,recurrence:{...effects.recurrence,everyDays}}));
  for(const until of [effects.runAt,new Date(Date.now()+91*day).toISOString(),"2026-10-10T12:00:00"]) assert.throws(()=>validateActionPayload("schedule_followup",{...effects,recurrence:{everyDays:1,until}}));
  assert.throws(()=>validateActionPayload("schedule_followup",{...effects,sendEmail:true}));
  assert.throws(()=>validateActionPayload("schedule_followup",{...effects,recurrence:{...effects.recurrence,recipients:["someone@example.invalid"]}}));
  const startsAt="2026-10-10T10:00:00.000Z";
  const due={startsAt,nextRunAt:startsAt,everyDays:2,endsAt:"2026-10-30T10:00:00.000Z"};
  assert.deepEqual(dueOccurrence(due,Date.parse("2026-10-17T11:00:00Z")),{at:"2026-10-16T10:00:00.000Z",next:"2026-10-18T10:00:00.000Z",skipped:3});
  assert.equal(dueOccurrence(due,Date.parse(due.endsAt)),null);
});

test("the model proposes a recurring permission; approval once permits deduplicated case-only occurrences",async(t)=>{
  const app=await runtime(t,{emailEnabled:true});
  const effects=payload(Date.now()+1_500);
  app.replies([call("get_case",{caseId:"CASE-A"}),call("propose_scheduled_followup",{caseId:"CASE-A",...effects}),answer()]);
  const chat=await app.chat("Prepare a daily follow-up for this case with the displayed first run and expiry.");
  const proposal=chat.find((event)=>event.type==="done").metadata.proposal;
  assert.deepEqual(proposal.payload,effects);
  assert.equal(await count(app,"assistant_recurring_schedules"),0);
  assert.equal(await count(app,"assistant_agent_runs"),0);
  assert.equal((await app.review(proposal)).status,200);
  assert.equal((await app.review(proposal)).status,409);
  const before=await app.db.prepare("SELECT * FROM recovery_cases WHERE id='CASE-A'").first();
  const first=await schedule(app,proposal.id);
  assert.equal(first.approvedByUserId,"reviewer");assert.equal(first.nextRunAt,effects.runAt);
  const modelCount=app.requests.length;
  app.replies([call("get_case",{caseId:"CASE-A"}),call("get_case_evidence",{caseId:"CASE-A"}),answer(["case:CASE-A:evidence"])]);
  const results=await Promise.all([tick(app,Date.parse(effects.runAt)),tick(app,Date.parse(effects.runAt))]);
  assert.ok(results.every((response)=>response.status===200));
  const runs=await app.db.prepare("SELECT * FROM assistant_agent_runs").all();
  assert.equal(runs.results.length,1);
  const run=runs.results[0];assert.equal(run.recurring_schedule_id,proposal.id);assert.equal(run.approval_proposal_id,null);
  await app.waitRun(run.id,["completed"]);
  assert.ok(app.requests.slice(modelCount).every((request)=>request.tools.every((tool)=>["get_case","get_case_evidence","get_case_checks"].includes(tool.function.name))));
  assert.deepEqual(await app.db.prepare("SELECT * FROM recovery_cases WHERE id='CASE-A'").first(),before);
  assert.equal(app.emailRequests.length,0);
  assert.equal(await count(app,"correspondence_events"),0);
  const detail=await (await app.fetch(`/api/assistant/runs?id=${run.id}`,{actor:"reviewer"})).json();
  assert.equal(detail.events.filter((event)=>event.eventType==="tool_completed").length,2);
  const history=await (await app.fetch(`/api/assistant/schedules?id=${proposal.id}`,{actor:"reviewer"})).json();
  assert.equal(history.events.filter((event)=>event.eventType==="occurrence_queued").length,1);
  const approvedEvent=history.events.find((event)=>event.eventType==="permission_approved");
  assert.deepEqual(approvedEvent.payload.effects,effects);
  await tick(app,Date.parse(effects.runAt)+3*day+500);
  const after=await schedule(app,proposal.id);
  assert.equal(after.nextRunAt,new Date(Date.parse(effects.runAt)+4*day).toISOString());
  const skipped=await (await app.fetch(`/api/assistant/schedules?id=${proposal.id}`,{actor:"reviewer"})).json();
  assert.equal(skipped.events.at(-1).payload.skippedMissedOccurrences,2);
  assert.equal(await count(app,"assistant_agent_runs"),2);
  await tick(app,Date.parse(effects.runAt)+3*day+500);
  assert.equal(await count(app,"assistant_agent_runs"),2);
});

test("pause stops in-flight work and resuming requires a separate exact approval",async(t)=>{
  const app=await runtime(t);
  const permission=await approved(app,payload(Date.now()+400));
  let release;
  const held=new Promise((resolve)=>{release=resolve;});
  t.after(()=>release(answer()));
  app.replies([()=>held,answer()]);
  await tick(app,Date.parse(permission.startsAt));
  const deadline=Date.now()+10_000;
  while(!app.requests.length&&Date.now()<deadline) await new Promise((resolve)=>setTimeout(resolve,50));
  assert.equal(app.requests.length,1);
  const live=await schedule(app,permission.id);
  assert.equal((await control(app,live,"pause")).status,200);
  release(call("get_case",{caseId:"CASE-A"}));
  const oldRun=await app.db.prepare("SELECT * FROM assistant_agent_runs").first();
  await app.waitRun(oldRun.id,["canceled"]);
  const saved=await (await app.fetch(`/api/assistant/runs?id=${oldRun.id}`,{actor:"reviewer"})).json();
  assert.equal(saved.events.filter((event)=>event.eventType==="tool_completed").length,0);
  assert.equal((await app.db.prepare("SELECT content FROM assistant_messages WHERE id=?").bind(oldRun.assistant_message_id).first()).content,"");
  const paused=await schedule(app,permission.id);
  assert.equal(paused.status,"paused");
  await tick(app,Date.parse(permission.startsAt)+day);
  assert.equal(await count(app,"assistant_agent_runs"),1);
  assert.equal((await control(app,paused,"resume")).status,400);
  await assert.rejects(app.db.prepare("UPDATE assistant_recurring_schedules SET status='active' WHERE id=?").bind(paused.id).run(),/new approval/);
  const proposed=await control(app,paused,"prepare_change",{payload:payload(Date.now()+day)});
  assert.equal(proposed.status,201,await proposed.clone().text());
  const change=(await proposed.json()).proposal;
  assert.equal((await schedule(app,permission.id)).status,"paused");
  assert.equal(await count(app,"assistant_recurring_schedules"),1);
  assert.equal((await app.review(change)).status,200);
  assert.equal((await schedule(app,change.id)).status,"active");
  assert.equal((await schedule(app,permission.id)).status,"revoked");
  assert.equal((await control(app,await schedule(app,permission.id),"prepare_change",{payload:payload()})).status,409);
  assert.equal((await app.review(change)).status,409);
});

test("schedule changes use the current permission version and approval rolls back all changes on audit failure",async(t)=>{
  const app=await runtime(t);
  const original=await approved(app,payload(Date.now()+day));
  const response=await control(app,original,"prepare_change",{payload:{...payload(Date.now()+2*day),question:"Inspect only current case checks.",recurrence:{everyDays:2,until:new Date(Date.now()+10*day).toISOString()}}});
  assert.equal(response.status,201,await response.clone().text());
  const proposal=(await response.json()).proposal;
  assert.equal((await schedule(app,original.id)).everyDays,1);
  await app.db.prepare("CREATE TRIGGER synthetic_schedule_audit_failure BEFORE INSERT ON audit_events WHEN NEW.event_type='AI_SCHEDULE_FOLLOWUP_PROPOSAL_APPROVED' BEGIN SELECT RAISE(ABORT,'synthetic schedule audit failure'); END").run();
  assert.equal((await app.review(proposal)).status,500);
  assert.equal(await count(app,"assistant_recurring_schedules"),1);
  assert.equal((await schedule(app,original.id)).status,"active");
  await app.db.prepare("DROP TRIGGER synthetic_schedule_audit_failure").run();
  assert.equal((await control(app,original,"pause")).status,200);
  assert.equal((await app.review(proposal)).status,409);
  assert.equal((await control(app,original,"revoke")).status,409);
  assert.equal((await app.review(proposal,"reject")).status,200);
  const current=await schedule(app,original.id);
  assert.equal((await control(app,current,"prepare_change",{payload:payload(),role:"admin",actorUserId:"outsider"})).status,201);
  const pending=await app.db.prepare("SELECT id FROM assistant_action_proposals WHERE status='pending'").first();
  const preview=(await (await app.fetch(`/api/assistant/proposals?id=${pending.id}`,{actor:"reviewer"})).json()).proposals[0];
  assert.equal((await app.review(preview)).status,200);
  assert.equal((await schedule(app,pending.id)).approvedByUserId,"reviewer");
});

test("revoked requester, approver or scope suspends permission and restoration cannot silently resume it",async(t)=>{
  for(const mutation of [
    "UPDATE workspace_memberships SET status='suspended' WHERE user_id='owner'",
    "UPDATE users SET status='disabled' WHERE id='owner'",
    "UPDATE workspace_memberships SET role='analyst' WHERE user_id='reviewer'",
    "UPDATE clients SET status='archived' WHERE id='client-a'",
    "UPDATE recovery_cases SET deleted_at='2026-10-09T00:00:00.000Z' WHERE id='CASE-A'",
  ]) await t.test(mutation,async(st)=>{
    const app=await runtime(st);
    const permission=await approved(app,payload(Date.now()+day));
    await app.db.prepare(mutation).run();
    assert.equal((await tick(app,Date.parse(permission.startsAt))).status,200);
    const row=await app.db.prepare("SELECT * FROM assistant_recurring_schedules WHERE id=?").bind(permission.id).first();
    assert.equal(row.status,"suspended");assert.equal(row.next_run_at,null);
    assert.equal(await count(app,"assistant_agent_runs"),0);assert.equal(app.requests.length,0);assert.equal(app.emailRequests.length,0);
    await app.db.batch([
      app.db.prepare("UPDATE workspace_memberships SET status='active' WHERE user_id='owner'"),app.db.prepare("UPDATE users SET status='active' WHERE id='owner'"),
      app.db.prepare("UPDATE workspace_memberships SET role='reviewer' WHERE user_id='reviewer'"),app.db.prepare("UPDATE clients SET status='active' WHERE id='client-a'"),
      app.db.prepare("UPDATE recovery_cases SET deleted_at=NULL WHERE id='CASE-A'"),
    ]);
    await tick(app,Date.parse(permission.startsAt)+day);
    assert.equal(await count(app,"assistant_agent_runs"),0);
    await assert.rejects(app.db.prepare("UPDATE assistant_recurring_schedules SET status='active' WHERE id=?").bind(permission.id).run(),/new approval/);
    assert.equal((await control(app,await schedule(app,permission.id),"revoke")).status,200);
  });
});

test("expiry, client history scoping and append-only controls survive access changes",async(t)=>{
  const app=await runtime(t);
  const permission=await approved(app);
  assert.equal((await app.fetch(`/api/assistant/schedules?id=${permission.id}`,{actor:"analyst"})).status,404);
  assert.equal((await app.fetch(`/api/assistant/schedules?id=${permission.id}`,{actor:"outsider"})).status,404);
  assert.equal((await control(app,permission,"pause",{expectedUpdatedAt:"stale"})).status,409);
  assert.equal((await app.fetch("/api/assistant/schedules",{actor:"analyst",method:"POST",body:{scheduleId:permission.id,expectedUpdatedAt:permission.updatedAt,action:"revoke",note:"Forged owner role",userId:"owner",role:"admin"}})).status,404);
  await app.db.prepare("UPDATE workspace_settings SET default_client_id='client-other' WHERE workspace_id='ws-a'").run();
  assert.equal((await app.fetch(`/api/assistant/schedules?id=${permission.id}`,{actor:"reviewer"})).status,404);
  await app.db.prepare("UPDATE workspace_settings SET default_client_id='client-a' WHERE workspace_id='ws-a'").run();
  await Promise.all([tick(app,Date.parse(permission.endsAt)),tick(app,Date.parse(permission.endsAt))]);
  const history=await (await app.fetch(`/api/assistant/schedules?id=${permission.id}`,{actor:"reviewer"})).json();
  assert.equal(history.schedule.status,"expired");
  assert.equal(history.events.filter((event)=>event.eventType==="expired").length,1);
  assert.equal(await count(app,"assistant_agent_runs"),0);
  await assert.rejects(app.db.prepare("UPDATE assistant_schedule_events SET payload_json='{}' WHERE schedule_id=?").bind(permission.id).run(),/append-only/);
  await assert.rejects(app.db.prepare("DELETE FROM assistant_schedule_events WHERE schedule_id=?").bind(permission.id).run(),/append-only/);
  await assert.rejects(app.db.prepare("UPDATE assistant_recurring_schedules SET every_days=2 WHERE id=?").bind(permission.id).run(),/new approval/);
  await assert.rejects(app.db.prepare("DELETE FROM assistant_recurring_schedules WHERE id=?").bind(permission.id).run(),/retained/);
});

test("recurring rejection creates no standing permission and approval cannot revive an ineligible requester",async(t)=>{
  const app=await runtime(t);
  const rejected=await app.propose("schedule_followup",payload());
  assert.equal((await app.review(rejected,"reject")).status,200);
  assert.equal(await count(app,"assistant_recurring_schedules"),0);
  const proposal=await app.propose("schedule_followup",payload());
  await app.db.prepare("UPDATE workspace_memberships SET role='read_only' WHERE user_id='owner'").run();
  assert.equal((await app.review(proposal)).status,409);
  assert.equal(await count(app,"assistant_recurring_schedules"),0);
  assert.equal(await count(app,"assistant_agent_runs"),0);
});

test("revoking the standing approver during a model call prevents later reads and publication",async(t)=>{
  const app=await runtime(t);
  const permission=await approved(app,payload(Date.now()+400));
  let release;
  const held=new Promise((resolve)=>{release=resolve;});
  t.after(()=>release(answer()));
  app.replies([()=>held,answer()]);
  await tick(app,Date.parse(permission.startsAt));
  const deadline=Date.now()+10_000;
  while(!app.requests.length&&Date.now()<deadline) await new Promise((resolve)=>setTimeout(resolve,50));
  assert.equal(app.requests.length,1);
  await app.db.prepare("UPDATE workspace_memberships SET role='analyst' WHERE user_id='reviewer'").run();
  release(call("get_case",{caseId:"CASE-A"}));
  const run=await app.db.prepare("SELECT * FROM assistant_agent_runs").first();
  await app.waitRun(run.id,["failed"]);
  assert.equal(app.requests.length,1);
  assert.equal((await app.db.prepare("SELECT count(*) AS n FROM assistant_run_events WHERE run_id=? AND event_type='tool_completed'").bind(run.id).first()).n,0);
  assert.equal((await app.db.prepare("SELECT content FROM assistant_messages WHERE id=?").bind(run.assistant_message_id).first()).content,"");
  assert.equal(await count(app,"audit_events"),1);
});

test("reviewers can page all recurring permissions without crossing client scope",async(t)=>{
  const app=await runtime(t);
  const effects=payload(Date.now()+day);
  const statements=[];
  for(let index=0;index<52;index++) {
    const id=crypto.randomUUID();
    const created=new Date(Date.now()-index*1_000).toISOString();
    statements.push(
      app.db.prepare(`INSERT INTO assistant_action_proposals (id,workspace_id,client_id,conversation_id,ai_job_id,case_id,case_updated_at,action_type,payload_json,source_labels_json,proposed_by_user_id,status,reviewed_by_user_id,reviewer_note,reviewed_at,decision_id,created_at)
        SELECT ?,'ws-a','client-a','conv-owner',?,'CASE-A',updated_at,'schedule_followup',?,'["case:CASE-A"]','owner','approved','reviewer','Reviewed synthetic permission',?,?,? FROM recovery_cases WHERE id='CASE-A'`).bind(id,id,JSON.stringify({...effects,customer:"Synthetic Acme"}),created,id,created),
      app.db.prepare(`INSERT INTO assistant_recurring_schedules (id,workspace_id,client_id,conversation_id,user_id,case_id,question,starts_at,every_days,ends_at,approval_proposal_id,approved_by_user_id,next_run_at,created_at,updated_at)
        VALUES (?,'ws-a','client-a','conv-owner','owner','CASE-A',?,?,1,?,?,'reviewer',?,?,?)`).bind(id,effects.question,effects.runAt,effects.recurrence.until,id,effects.runAt,created,created),
    );
  }
  await app.db.batch(statements);
  const first=await (await app.fetch("/api/assistant/schedules",{actor:"reviewer"})).json();
  assert.equal(first.schedules.length,50);assert.ok(first.nextCursor);
  const second=await (await app.fetch(`/api/assistant/schedules?cursor=${encodeURIComponent(first.nextCursor)}`,{actor:"reviewer"})).json();
  assert.equal(second.schedules.length,2);assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.schedules,...second.schedules].map((row)=>row.id)).size,52);
  assert.equal((await (await app.fetch("/api/assistant/schedules",{actor:"analyst"})).json()).schedules.length,0);
  await app.db.prepare("UPDATE workspace_settings SET default_client_id='client-other' WHERE workspace_id='ws-a'").run();
  assert.equal((await (await app.fetch("/api/assistant/schedules",{actor:"reviewer"})).json()).schedules.length,0);
});
