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
async function start(file, mode = 'serve') {
 const child = spawn(process.execPath,[harness.pathname,mode,file],{stdio:['ignore','pipe','pipe']});
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


test('24 concurrent real producer confirms persist one event, read through HTTP Office route after restart',async()=>{
 const {handleOwnerRequestRead}=await import('../src/greenhouse/request-owner-http.mjs');
 const {DatabaseSync}=await import('node:sqlite');
 const dir=await mkdtemp(join(tmpdir(),'greenhouse-owner-http-'));let owner,office;
 try {
  const file=join(dir,'requests.sqlite');owner=await start(file,'owner');
  const session=await fetch(owner.base+'/api/v1/requests');assert.equal(session.status,200);
  const cookie=session.headers.get('set-cookie').split(';')[0];
  const headers={origin:'https://yggmetro.com',cookie,'content-type':'application/json'};
  const created=await fetch(owner.base+'/api/v1/requests/synthetic-http',{method:'POST',headers,body:JSON.stringify({brief:{goal:'SYNTHETIC PRIVATE GOAL'}})});assert.equal(created.status,200);
  const confirms=await Promise.all(Array.from({length:24},()=>fetch(owner.base+'/api/v1/requests/synthetic-http/confirm',{method:'POST',headers,body:'{}'})));
  for(const response of confirms)assert.equal(response.status,200,await response.text());
  const db=new DatabaseSync(file,{readOnly:true});
  const rows=db.prepare("SELECT event_id,timestamp FROM ygg_request_events WHERE request_id='synthetic-http' AND to_value='SUBMITTED'").all();assert.equal(rows.length,1);db.close();
  const request=new Request('https://greenhouse-owner.pages.dev/api/greenhouse/requests/synthetic-http',{headers:{authorization:'Bearer synthetic-owner-token-at-least-32-bytes'}});
  const fetchImpl=(url,options)=>{assert.ok(/^https:\/\/yggmetro\.com\/api\/v1\/admin\/requests\/(synthetic-http|synthetic-greenhouse-runner)$/.test(url));assert.equal(options.method,'GET');assert.equal(options.redirect,'error');return fetch(owner.base+new URL(url).pathname,options);};
  const {createGreenhouseServer}=await import('../server.mjs');
  office=createGreenhouseServer({fetchImpl});await new Promise(resolve=>office.listen(0,'127.0.0.1',resolve));
  const officeRead=()=>fetch('http://127.0.0.1:'+office.address().port+'/api/greenhouse/requests/synthetic-http',{headers:request.headers});
  const first=await officeRead();assert.equal(first.status,200);const before=await first.json();
  assert.equal(before.items[0].sourceEventId,rows[0].event_id);assert.equal(before.items[0].occurredAt,rows[0].timestamp);assert.equal(before.items[0].evidenceScope,'OWNER_HTTP_READBACK');assert.equal(before.items[0].receiptId,null);assert.ok(!JSON.stringify(before).includes('PRIVATE GOAL'));
  await owner.stop();owner=await start(file,'owner');
  const second=await officeRead();assert.equal(second.status,200);assert.deepEqual((await second.json()).items,before.items);
  const {verifyRequestChain}=await import('../scripts/verify-request-chain.mjs');
  const result=await verifyRequestChain({target:'https://greenhouse-owner.pages.dev',requestId:'synthetic-greenhouse-runner',token:'synthetic-owner-token-at-least-32-bytes',fetchImpl:(url,options)=>{
   const u=new URL(url);
   if(u.origin==='https://yggmetro.com')return fetch(owner.base+u.pathname,options);
   assert.equal(u.origin,'https://greenhouse-owner.pages.dev');
   return fetch('http://127.0.0.1:'+office.address().port+u.pathname,options);
  }});
  assert.equal(result.officeReadback,true);assert.equal(result.hubDeliveryVerified,false);
  console.log(JSON.stringify({evidenceScope:'LOCAL_HTTP_INTEGRATION',concurrentProducerConfirms:24,persistedSubmissionEvents:rows.length,ownerProcessRestarted:true,sourceEventId:rows[0].event_id,receiptStatus:'MISSING',liveDeployment:false}));
 }finally{if(office)await new Promise(resolve=>office.close(resolve));if(owner)await owner.stop();await rm(dir,{recursive:true,force:true});}
});

test('HTTP owner reader rejects bad credentials, redirects, forged records and invalid inputs',async()=>{
 const {readOwnerRequest,handleOwnerRequestRead}=await import('../src/greenhouse/request-owner-http.mjs');
 const config={requestId:'synthetic-http',authorization:'Bearer synthetic-owner-token-at-least-32-bytes'};
 await assert.rejects(readOwnerRequest({...config,requestId:'../customers'}),{code:'REQUEST_ID_INVALID'});
 await assert.rejects(readOwnerRequest({...config,authorization:'Bearer short'}),{code:'OWNER_AUTH_REQUIRED'});
 for(const status of [401,403,404,302,503])await assert.rejects(readOwnerRequest({...config,fetchImpl:async()=>new Response('',{status})}));
 for(const body of [{ok:true,request:{request_id:'other'},events:[]},{ok:true,request:{request_id:'synthetic-http'},events:[]},{ok:true,request:{request_id:'synthetic-http'},events:Array(2).fill({kind:'STATUS',from_value:'DRAFT',to_value:'SUBMITTED'})}])await assert.rejects(readOwnerRequest({...config,fetchImpl:async()=>Response.json(body)}));
 await assert.rejects(readOwnerRequest({...config,fetchImpl:async()=>new Response('x'.repeat(262145))}),{code:'REQUEST_OWNER_TOO_LARGE'});
 const called=()=>{throw Error('must not call owner');};
 for(const [request,status] of [[new Request('https://greenhouse-owner.pages.dev/api/greenhouse/requests/synthetic-http',{method:'POST'}),405],[new Request('https://greenhouse-owner.pages.dev/api/greenhouse/requests/synthetic-http',{headers:{origin:'https://evil.test'}}),403],[new Request('https://greenhouse-owner.pages.dev/api/greenhouse/requests/synthetic-http?token=forbidden'),400]])assert.equal((await handleOwnerRequestRead(request,'synthetic-http',{fetchImpl:called})).status,status);
});
