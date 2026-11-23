import test from "node:test";
import assert from "node:assert/strict";
import {runtime,emailResponse} from "./support/assistant-runtime.mjs";

const draftEffects={channel:"email",recipient:"customer@example.invalid",subject:"Receipt evidence request",body:"Please provide the original receipt for practitioner review. <Evidence & review> must be assessed by a human."};
async function draft(app,changes={}) {
  const proposal=await app.propose("communication_draft",{...draftEffects,...changes});
  const response=await app.review(proposal);
  assert.equal(response.status,200,await response.text());
  return proposal.id;
}
const post=(app,body,options={})=>app.fetch("/api/assistant/deliveries",{actor:"reviewer",method:"POST",body,...options});
async function prepare(app,draftId,extra={}) {
  const response=await post(app,{action:"prepare",draftId,recipient:draftEffects.recipient,...extra});
  assert.equal(response.status,201,await response.clone().text());
  return (await response.json()).delivery;
}
const decide=(app,row,action="approve",extra={},options={})=>post(app,{action,deliveryId:row.id,previewHash:row.previewHash,note:"Reviewed the exact sender, recipient and message.",...extra},options);
const count=async(app,table,where="1=1")=>(await app.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).first()).n;
const saved=(app,id)=>app.db.prepare("SELECT * FROM communication_deliveries WHERE id=?").bind(id).first();
async function oldPermission(app,draftId,from="recovery@sender.example.invalid") {
  const id=crypto.randomUUID();
  await app.db.prepare(`INSERT INTO communication_deliveries (id,workspace_id,client_id,case_id,draft_id,draft_version,case_updated_at,from_address,to_address,subject,body,requested_by_user_id,created_at)
    SELECT ?,d.workspace_id,rc.client_id,d.case_id,d.id,d.version,rc.updated_at,?,?,d.subject,d.body,'reviewer',? FROM communication_drafts d JOIN recovery_cases rc ON rc.id=d.case_id WHERE d.id=?`)
    .bind(id,from,draftEffects.recipient,new Date().toISOString(),draftId).run();
  return (await (await app.fetch(`/api/assistant/deliveries?id=${id}`,{actor:"reviewer"})).json()).deliveries[0];
}

test("an approved draft and prepared permission send nothing; an exact human send applies once and records provider acceptance",async(t)=>{
  const app=await runtime(t,{emailEnabled:true});
  const draftId=await draft(app);
  assert.equal(app.emailRequests.length,0);
  const permission=await prepare(app,draftId,{body:"Browser text must not replace approved effects",from:"attacker@example.invalid",actorUserId:"outsider"});
  assert.equal(permission.subject,draftEffects.subject);assert.equal(permission.body,draftEffects.body);assert.equal(permission.fromAddress,"recovery@sender.example.invalid");
  assert.equal(permission.toAddress,draftEffects.recipient);assert.equal(permission.status,"pending");
  const before=await app.db.prepare("SELECT stage,exception_code,expected_wht_kobo FROM recovery_cases WHERE id='CASE-A'").first();
  assert.equal(app.emailRequests.length,0);
  const result=await decide(app,permission,"approve",{payload:{to:"attacker@example.invalid"},role:"admin",actorUserId:"outsider"});
  assert.equal(result.status,200,await result.clone().text());
  assert.equal((await result.json()).status,"accepted");
  assert.equal(app.emailRequests.length,1);
  assert.deepEqual(app.emailRequests[0].payload,{from:permission.fromAddress,to:[permission.toAddress],subject:permission.subject,text:permission.body,html:'<div style="white-space:pre-wrap">Please provide the original receipt for practitioner review. &lt;Evidence &amp; review&gt; must be assessed by a human.</div>'});
  assert.equal(app.emailRequests[0].idempotencyKey,`wht-email/${permission.id}`);
  assert.equal((await decide(app,permission)).status,409);
  assert.equal((await post(app,{action:"prepare",draftId,recipient:draftEffects.recipient})).status,409);
  const accepted=await saved(app,permission.id);
  assert.equal(accepted.status,"accepted");assert.equal(accepted.reviewed_by_user_id,"reviewer");assert.equal(accepted.provider_message_id,"synthetic-email-1");
  const event=await app.db.prepare("SELECT * FROM correspondence_events").first();
  assert.equal(event.event_type,"accepted_by_provider");assert.equal(event.body,permission.body);assert.equal(event.recorded_by_user_id,"reviewer");
  const audit=await app.db.prepare("SELECT actor_user_id,detail_json FROM audit_events WHERE event_type='EMAIL_DELIVERY_ACCEPTED'").first();
  assert.equal(audit.actor_user_id,"reviewer");assert.equal(JSON.parse(audit.detail_json).deliveryConfirmed,false);
  assert.deepEqual(await app.db.prepare("SELECT stage,exception_code,expected_wht_kobo FROM recovery_cases WHERE id='CASE-A'").first(),before);
  assert.equal(app.requests.length,0);
});

test("concurrent approvals consume one permission, create one approval audit and make one provider request",async(t)=>{
  const app=await runtime(t,{emailEnabled:true});
  const permission=await prepare(app,await draft(app));
  const responses=await Promise.all([decide(app,permission),decide(app,permission)]);
  assert.deepEqual(responses.map((response)=>response.status).sort(),[200,409]);
  assert.equal(app.emailRequests.length,1);
  assert.equal(await count(app,"audit_events","event_type='EMAIL_SEND_PERMISSION_APPROVED'"),1);
  assert.equal(await count(app,"audit_events","event_type='EMAIL_DELIVERY_ACCEPTED'"),1);
  assert.equal(await count(app,"correspondence_events"),1);
  await assert.rejects(app.db.prepare("UPDATE communication_deliveries SET to_address='attacker@example.invalid' WHERE id=?").bind(permission.id).run(),/immutable/);
  await assert.rejects(app.db.prepare("UPDATE communication_deliveries SET status='sending' WHERE id=?").bind(permission.id).run(),/immutable/);
  await assert.rejects(app.db.prepare("DELETE FROM communication_deliveries WHERE id=?").bind(permission.id).run(),/retained/);
});

test("rejection never sends and a new permission needs its own preview and human approval",async(t)=>{
  const app=await runtime(t,{emailEnabled:true});
  const draftId=await draft(app);
  const permission=await prepare(app,draftId);
  assert.equal((await decide(app,permission,"reject")).status,200);
  assert.equal((await decide(app,permission)).status,409);
  const replacement=await prepare(app,draftId);
  assert.notEqual(replacement.previewHash,permission.previewHash);
  assert.equal((await decide(app,replacement,"approve",{previewHash:permission.previewHash})).status,409);
  await app.fetch("/__test/recover-deliveries",{method:"POST",body:{now:Date.now()+day}});
  assert.equal(app.emailRequests.length,0);
  assert.equal((await saved(app,replacement.id)).status,"pending");
});
const day=86_400_000;

test("delivery requires a current reviewer, client scope, origin, hash and server-derived effects",async(t)=>{
  const app=await runtime(t,{emailEnabled:true});
  const permission=await prepare(app,await draft(app));
  assert.equal((await decide(app,permission,"approve",{previewHash:"0".repeat(64)})).status,409);
  for(const actor of ["analyst","reader"]) {
    assert.equal((await decide(app,permission,"approve",{role:"admin",actorUserId:"reviewer"},{actor})).status,403);
    assert.equal((await app.fetch(`/api/assistant/deliveries?id=${permission.id}`,{actor})).status,404);
  }
  assert.equal((await decide(app,permission,"approve",{},{actor:"outsider"})).status,404);
  assert.equal((await decide(app,permission,"approve",{},{headers:{origin:"https://untrusted.example"}})).status,403);
  await app.db.prepare("UPDATE workspace_settings SET default_client_id='client-other' WHERE workspace_id='ws-a'").run();
  assert.equal((await decide(app,permission)).status,404);
  await app.db.prepare("UPDATE workspace_settings SET default_client_id='client-a' WHERE workspace_id='ws-a'").run();
  await app.db.prepare("UPDATE workspace_memberships SET role='read_only' WHERE user_id='reviewer'").run();
  assert.equal((await decide(app,permission)).status,403);
  assert.equal(app.emailRequests.length,0);
  assert.equal((await saved(app,permission.id)).status,"pending");
});

test("stale cases and changed or unapproved draft bodies invalidate an exact send",async(t)=>{
  for(const mutation of [
    "UPDATE recovery_cases SET updated_at='2026-11-01T00:00:00.000Z' WHERE id='CASE-A'",
    "UPDATE recovery_cases SET deleted_at='2026-10-09T00:00:00.000Z' WHERE id='CASE-A'",
    "UPDATE communication_drafts SET version=version+1 WHERE case_id='CASE-A'",
    "UPDATE communication_drafts SET body='Changed text without an honest version increment.' WHERE case_id='CASE-A'",
    "UPDATE communication_drafts SET status='draft',approved_at=NULL WHERE case_id='CASE-A'",
  ]) await t.test(mutation,async(st)=>{
    const app=await runtime(st,{emailEnabled:true});
    const permission=await prepare(app,await draft(app));
    await app.db.prepare(mutation).run();
    assert.equal((await decide(app,permission)).status,409);
    assert.equal(app.emailRequests.length,0);assert.equal(await count(app,"correspondence_events"),0);
    assert.equal((await saved(app,permission.id)).status,"pending");
    assert.equal((await decide(app,permission,"reject")).status,200);
  });
});

test("delivery rejects multiple recipients, header injection, letter drafts and inactive send configuration",async(t)=>{
  const app=await runtime(t,{emailEnabled:true});
  const draftId=await draft(app);
  for(const recipient of ["a@example.invalid,b@example.invalid","Display Name <a@example.invalid>","a@example.invalid\r\nBcc: b@example.invalid","https://example.invalid",["a@example.invalid"]])
    assert.equal((await post(app,{action:"prepare",draftId,recipient})).status,422);
  const letter=await draft(app,{channel:"letter"});
  assert.equal((await post(app,{action:"prepare",draftId:letter,recipient:draftEffects.recipient})).status,422);
  const headers=await draft(app,{subject:"Receipt\r\nBcc: attacker@example.invalid"});
  assert.equal((await post(app,{action:"prepare",draftId:headers,recipient:draftEffects.recipient})).status,422);
  const earlierSender=await oldPermission(app,draftId,"previous@sender.example.invalid");
  assert.equal((await decide(app,earlierSender)).status,409);
  assert.equal(app.emailRequests.length,0);
  await t.test("disabled sender",async(st)=>{
    const disabled=await runtime(st);
    const draftId=await draft(disabled);
    assert.equal((await post(disabled,{action:"prepare",draftId,recipient:draftEffects.recipient})).status,503);
    const pending=await oldPermission(disabled,draftId);
    assert.equal((await decide(disabled,pending)).status,409);
    assert.equal((await decide(disabled,pending,"reject")).status,200);
    assert.equal(disabled.emailRequests.length,0);
    const page=await (await disabled.fetch("/api/assistant/deliveries",{actor:"reviewer"})).json();
    assert.equal(page.ready,false);assert.doesNotMatch(JSON.stringify(page),/re_synthetic_test_key/);
  });
});

test("failed approval audit rolls back permission before contacting Resend",async(t)=>{
  const app=await runtime(t,{emailEnabled:true});
  const permission=await prepare(app,await draft(app));
  await app.db.prepare("CREATE TRIGGER synthetic_email_audit_failure BEFORE INSERT ON audit_events WHEN NEW.event_type='EMAIL_SEND_PERMISSION_APPROVED' BEGIN SELECT RAISE(ABORT,'synthetic email approval audit failure'); END").run();
  assert.equal((await decide(app,permission)).status,500);
  assert.equal((await saved(app,permission.id)).status,"pending");
  assert.equal(app.emailRequests.length,0);
  await app.db.prepare("DROP TRIGGER synthetic_email_audit_failure").run();
  assert.equal((await decide(app,permission)).status,200);
  assert.equal(app.emailRequests.length,1);
});

test("access revoked after the atomic send claim still prevents a provider request",async(t)=>{
  const app=await runtime(t,{emailEnabled:true});
  const permission=await prepare(app,await draft(app));
  await app.db.prepare("CREATE TRIGGER synthetic_revoke_after_claim AFTER UPDATE ON communication_deliveries WHEN NEW.status='sending' BEGIN UPDATE workspace_memberships SET status='suspended' WHERE user_id='reviewer'; END").run();
  const response=await decide(app,permission);
  assert.equal(response.status,200);
  assert.equal((await response.json()).status,"failed");
  assert.equal((await saved(app,permission.id)).status,"failed");
  assert.equal(app.emailRequests.length,0);
  assert.equal(await count(app,"audit_events","event_type='EMAIL_DELIVERY_BLOCKED'"),1);
});

test("migration 0010 preserves approved drafts and earlier one-time follow-up requests",async(t)=>{
  const app=await runtime(t,{stopBeforeMigration:"0010_recurring_permissions_and_delivery.sql"});
  const draftId=await draft(app);
  const runId=crypto.randomUUID();
  const runAt=new Date(Date.now()+day).toISOString();
  await app.db.batch([
    app.db.prepare(`INSERT INTO assistant_action_proposals (id,workspace_id,client_id,conversation_id,ai_job_id,case_id,case_updated_at,action_type,payload_json,source_labels_json,proposed_by_user_id,status,reviewed_by_user_id)
      SELECT ?,'ws-a','client-a','conv-owner',?,'CASE-A',updated_at,'schedule_followup',?,'["case:CASE-A"]','owner','approved','reviewer' FROM recovery_cases WHERE id='CASE-A'`).bind(runId,runId,JSON.stringify({runAt,question:"Inspect the case evidence at the approved time.",customer:"Synthetic Acme"})),
    app.db.prepare("INSERT INTO assistant_messages (id,conversation_id,role,content) VALUES (1,'conv-owner','user','Approved legacy follow-up'),(2,'conv-owner','assistant','')"),
    app.db.prepare("INSERT INTO assistant_agent_runs (id,workspace_id,client_id,conversation_id,user_id,user_message_id,assistant_message_id,question,case_id,scheduled_for,approval_proposal_id) VALUES (?,'ws-a','client-a','conv-owner','owner',1,2,'Inspect the case evidence at the approved time.','CASE-A',?,?)").bind(runId,runAt,runId),
  ]);
  const original=await app.db.prepare("SELECT * FROM communication_drafts WHERE id=?").bind(draftId).first();
  await app.apply("0010_recurring_permissions_and_delivery.sql");
  assert.deepEqual(await app.db.prepare("SELECT * FROM communication_drafts WHERE id=?").bind(draftId).first(),original);
  const row=await app.db.prepare("SELECT * FROM assistant_agent_runs WHERE id=?").bind(runId).first();
  assert.equal(row.approval_proposal_id,runId);assert.equal(row.scheduled_for,runAt);assert.equal(row.recurring_schedule_id,null);
  assert.equal((await app.fetch(`/api/assistant/runs?id=${runId}`,{actor:"reviewer"})).status,200);
  assert.equal(await count(app,"assistant_recurring_schedules"),0);assert.equal(await count(app,"communication_deliveries"),0);
  assert.equal(app.emailRequests.length,0);
});

test("a recording failure after provider acceptance stays uncertain and blocks every automatic or repeated send",async(t)=>{
  const app=await runtime(t,{emailEnabled:true});
  const draftId=await draft(app);
  const permission=await prepare(app,draftId);
  await app.db.prepare("CREATE TRIGGER synthetic_acceptance_audit_failure BEFORE INSERT ON audit_events WHEN NEW.event_type='EMAIL_DELIVERY_ACCEPTED' BEGIN SELECT RAISE(ABORT,'synthetic provider acceptance audit failure'); END").run();
  const response=await decide(app,permission);
  assert.equal(response.status,200);
  assert.equal((await response.json()).status,"unknown");
  const recorded=await saved(app,permission.id);
  assert.equal(recorded.status,"unknown");assert.equal(recorded.provider_message_id,"synthetic-email-1");
  assert.equal(await count(app,"correspondence_events"),0);
  assert.equal((await decide(app,permission)).status,409);
  assert.equal((await post(app,{action:"prepare",draftId,recipient:draftEffects.recipient})).status,409);
  await app.fetch("/__test/recover-deliveries",{method:"POST",body:{now:Date.now()+day}});
  assert.equal(app.emailRequests.length,1);
});

test("provider rejection allows only a fresh permission; uncertain responses are never retried",async(t)=>{
  for(const [label,reply,expected] of [
    ["invalid payload",emailResponse(422,{message:"Synthetic rejection"}),"failed"],
    ["server error",emailResponse(503,{message:"Synthetic server error"}),"unknown"],
    ["ambiguous conflict",emailResponse(409,{message:"Synthetic conflict"}),"unknown"],
    ["no acceptance identifier",emailResponse(200,{unexpected:true}),"unknown"],
    ["oversized response",emailResponse(200,{id:"x".repeat(5000)}),"unknown"],
    ["lost network response",()=>{throw new Error("Synthetic interrupted provider response");},"unknown"],
  ]) await t.test(label,async(st)=>{
    const app=await runtime(st,{emailEnabled:true});
    const draftId=await draft(app);
    const permission=await prepare(app,draftId);
    app.emailReplies([reply]);
    const result=await decide(app,permission);
    assert.equal(result.status,200,await result.clone().text());
    assert.equal((await result.json()).status,expected);
    assert.equal((await saved(app,permission.id)).status,expected);
    assert.equal(app.emailRequests.length,1);assert.equal(await count(app,"correspondence_events"),0);
    assert.equal((await decide(app,permission)).status,409);
    await app.fetch("/__test/recover-deliveries",{method:"POST",body:{now:Date.now()+day}});
    assert.equal(app.emailRequests.length,1);
    const retry=await post(app,{action:"prepare",draftId,recipient:draftEffects.recipient});
    assert.equal(retry.status,expected==="failed" ? 201 : 409);
    if(expected==="failed") {
      const fresh=(await retry.json()).delivery;
      assert.notEqual(fresh.previewHash,permission.previewHash);
      assert.equal(app.emailRequests.length,1);
      assert.equal((await decide(app,fresh)).status,200);
      assert.equal(app.emailRequests.length,2);
    }
  });
});

test("interrupted send claims are marked uncertain with one recovery audit and no provider call",async(t)=>{
  const app=await runtime(t,{emailEnabled:true});
  const draftId=await draft(app);
  const permission=await prepare(app,draftId);
  const then=new Date(Date.now()-180_000).toISOString();
  await app.db.prepare("UPDATE communication_deliveries SET status='sending',reviewed_by_user_id='reviewer',reviewer_note='Synthetic interrupted approval',decision_id=?,reviewed_at=?,attempted_at=? WHERE id=?")
    .bind(crypto.randomUUID(),then,then,permission.id).run();
  await Promise.all([app.fetch("/__test/recover-deliveries",{method:"POST",body:{}}),app.fetch("/__test/recover-deliveries",{method:"POST",body:{}})]);
  assert.equal((await saved(app,permission.id)).status,"unknown");
  assert.equal(await count(app,"audit_events","event_type='EMAIL_DELIVERY_UNKNOWN'"),1);
  assert.equal(app.emailRequests.length,0);
  assert.equal((await decide(app,permission)).status,409);
  assert.equal((await post(app,{action:"prepare",draftId,recipient:draftEffects.recipient})).status,409);
});
