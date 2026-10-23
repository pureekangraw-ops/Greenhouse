import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { signGreenhouseEvent } from '../src/greenhouse/events.mjs';
const harness = new URL('./fixtures/request-workflow/harness.mjs',import.meta.url);
const secret = 'synthetic-only-secret-at-least-32-bytes';
async function start(file) {
 const child = spawn(process.execPath,[harness.pathname,'serve',file],{stdio:['ignore','pipe','pipe']});
 let errors=''; child.stderr.on('data',chunk=>errors+=chunk);
 const port = await new Promise((resolve,reject)=>{
  child.once('exit',code=>reject(Error(`harness exit ${code}: ${errors}`)));
  let data=''; child.stdout.on('data',chunk=>{data+=chunk;if(data.includes('\n'))resolve(JSON.parse(data.split('\n')[0]).port)});
 });
 return {base:`http://127.0.0.1:${port}`,async stop(){const done=once(child,'exit');child.kill('SIGTERM');await done;}};
}
const post = (base,event,signatureOverride) => {
 const body=JSON.stringify(event), timestamp=String(Date.now());
 return fetch(base+'/api/greenhouse/events',{method:'POST',headers:{'x-greenhouse-timestamp':timestamp,'x-greenhouse-signature':signatureOverride||signGreenhouseEvent(body,timestamp,secret)},body});
};
const read = async base => {
 const response=await fetch(base+'/api/greenhouse/inbox',{headers:{authorization:'Bearer synthetic-office'}});
 assert.equal(response.status,200); return response.json();
};
test('real producer transaction survives process restart, concurrent replay and Office readback with AI off',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'greenhouse-request-'));let running;
 try {
  const file=join(dir,'requests.sqlite');
  const {event,count}=JSON.parse(execFileSync(process.execPath,[harness.pathname,'seed',file],{encoding:'utf8'}));
  assert.equal(count,1);
  running=await start(file);
  const first=await post(running.base,event);assert.equal(first.status,200);
  const evidence=await first.json();assert.equal(evidence.receiptId,null);assert.equal(evidence.receiptStatus,'MISSING');assert.equal(evidence.evidenceScope,'LOCAL_TEST');
  const responses=await Promise.all(Array.from({length:24},()=>post(running.base,event)));
  for(const response of responses){assert.equal(response.status,200);assert.equal((await response.json()).duplicate,true);}
  const before=await read(running.base);assert.equal(before.items.length,1);
  const item=before.items[0];assert.equal(item.sourceEventId,event.eventId);assert.equal(item.category,'REQUEST_SUBMITTED');assert.equal(item.occurredAt,event.occurredAt);assert.deepEqual(item.evidence,[event.payloadRef]);
  assert.ok(!JSON.stringify(before).includes('PRIVATE CONTENT'));
  assert.equal((await fetch(running.base+'/api/greenhouse/inbox')).status,401);
  assert.equal((await post(running.base,event,'sha256='+'0'.repeat(64))).status,401);
  assert.equal((await post(running.base,{...event,source:'unknown'})).status,403);
  assert.equal((await post(running.base,{...event,payload:{secret:'forbidden'}})).status,400);
  for(const changed of [{eventId:'forged'}, {correlationId:'other-request'}, {occurredAt:'2020-01-01T00:00:00Z'}, {workId:'WORK-fabricated'}, {payloadRef:'https://evil.test/?secret=private'}]) {
   assert.equal((await post(running.base,{...event,...changed})).status,409);
  }
  await running.stop();running=null;
  running=await start(file);
  const after=await read(running.base);assert.deepEqual(after.items,before.items);
  assert.equal((await post(running.base,event)).status,200);
  console.log(JSON.stringify({evidenceScope:'LOCAL_TEST',producerEvents:count,concurrentReplays:24,restartedProcess:true,sourceEventId:event.eventId,readbackItems:after.items.length,receiptStatus:'MISSING',ai:'OFF'}));
 } finally {if(running)await running.stop();await rm(dir,{recursive:true,force:true});}
});

test('Office inbox preserves bounded source evidence and drops private extras',async()=>{
 const {createGreenhouseServer}=await import('../server.mjs');
 const item={title:'Request submitted',sourceEventId:'source-1',category:'REQUEST_SUBMITTED',occurredAt:'2026-10-23T00:00:00Z',persistedAt:'2026-10-23T00:00:00Z',evidence:['ygg_request_events:source-1'],evidenceScope:'LOCAL_TEST',receiptId:null,receiptStatus:'MISSING',brief:'PRIVATE',actor_id:'PRIVATE'};
 const server=createGreenhouseServer({ownerSessionResolver:async()=>({actorId:'test'}),inboxReader:async()=>({items:[item],observedAt:'2026-10-23T00:00:00Z'})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const body=await read(`http://127.0.0.1:${server.address().port}`);
  assert.equal(body.items[0].sourceEventId,'source-1');assert.deepEqual(body.items[0].evidence,item.evidence);
  assert.equal(body.items[0].receiptId,null);assert.ok(!JSON.stringify(body).includes('PRIVATE'));
  item.evidence=Array(17).fill('too-many');
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/greenhouse/inbox`)).status,502);
 } finally {await new Promise(resolve=>server.close(resolve));}
});

test('local persistence cannot impersonate a Hub receipt without explicit test opt-in',async()=>{
 const {createGreenhouseServer}=await import('../server.mjs');
 const event={schemaVersion:'greenhouse.event.v1',source:'shop',eventId:'event-1',eventType:'request.submitted',occurredAt:new Date().toISOString(),classification:'INTERNAL'};
 const server=createGreenhouseServer({sourceRegistry:{shop:{secret,eventTypes:['request.submitted']}},hubEventSink:async()=>({receiptId:null,receiptStatus:'MISSING',evidenceScope:'LOCAL_TEST',persisted:true,duplicate:true,sourceEventId:event.eventId,persistedAt:event.occurredAt,evidence:[]})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {const response=await post(`http://127.0.0.1:${server.address().port}`,event);assert.equal(response.status,502);assert.equal((await response.json()).code,'HUB_RECEIPT_INVALID');}
 finally {await new Promise(resolve=>server.close(resolve));}
});

test('adapter fails closed on denied readers, missing records, unsupported scope and storage errors',async()=>{
 const {createRequestEventReadback}=await import('../src/greenhouse/request-event-readback.mjs');
 const db={prepare:()=>({bind:()=>({first:async()=>null,all:async()=>{throw Error('offline');}})})};
 assert.throws(()=>createRequestEventReadback({db,source:'shop',evidenceScope:'PRODUCTION',authorize:()=>true}),{code:'REQUEST_ADAPTER_CONFIG_INVALID'});
 const adapter=createRequestEventReadback({db,source:'shop',evidenceScope:'LOCAL_TEST',authorize:()=>false});
 await assert.rejects(adapter.inboxReader({session:{actorId:'forged'}}),{code:'REQUEST_READ_DENIED'});
 await assert.rejects(adapter.hubEventSink({event:{source:'shop',eventId:'absent',eventType:'request.submitted',correlationId:'request',payloadRef:'ygg_request_events:absent',classification:'INTERNAL'},idempotencyKey:'shop:absent'}),{code:'REQUEST_PROVENANCE_MISMATCH'});
 const allowed=createRequestEventReadback({db,source:'shop',evidenceScope:'LOCAL_TEST',authorize:()=>true});
 await assert.rejects(allowed.inboxReader({session:{actorId:'test'},cursor:'invalid'}),{code:'CURSOR_INVALID'});
 await assert.rejects(allowed.inboxReader({session:{actorId:'test'}}),/offline/);
});
