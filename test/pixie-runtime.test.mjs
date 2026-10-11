import test from 'node:test';
import assert from 'node:assert/strict';
import {createPixieDeliveryRuntime} from '../src/pixie/delivery-runtime.mjs';
import {createPixieIntelligence} from '../src/pixie/intelligence.mjs';

function setup({dispatch,failQueue=false}={}){
 const rows=new Map(), messages=[], transitions=[];
 const store={
  async create(input){if(rows.has(input.attemptId))return false; rows.set(input.attemptId,{...input});return true;},
  async get(id){return rows.get(id)?{...rows.get(id)}:null;},
  async transition(id,from,to,patch){const x=rows.get(id);if(!x||!from.includes(x.state))return false;
   rows.set(id,{...x,...patch,state:to});transitions.push(to);return true;},
  async listByState(states,n){return [...rows.values()].filter(x=>states.includes(x.state)).slice(0,n).map(x=>({...x}));},
 };
 const queue={async send(msg){if(failQueue)throw new Error('queue unavailable');messages.push(msg);}};
 const clock=()=> '2026-10-10T04:30:00.000Z';
 return {rows,messages,transitions,store,queue,clock,
  runtime:createPixieDeliveryRuntime({store,queue,dispatch,clock})};
}
const job={workId:'WORK-123',checkpointId:'WORK-123:CP-01',attemptId:'ATT-1',
 stationId:'FACTORY_STATION',operation:'CODE',workPassRef:'work-pass://WORK-PASS:WORK-123:GO',actor:'GO'};
test('intake is durable and idempotent with original Work ID',async()=>{
 const s=setup();
 const first=await s.runtime.intake(job);
 assert.equal(first.record.state,'QUEUED');
 assert.equal(s.messages.length,1);
 const repeated=await s.runtime.intake({...job});
 assert.equal(repeated.duplicate,true);
 assert.equal(s.messages.length,1);
 await assert.rejects(()=>s.runtime.intake({...job,workId:'WORK-OTHER',checkpointId:'WORK-OTHER:CP-01'}),/PIXIE_ATTEMPT_COLLISION/);
});
test('queue at-least-once never executes accepted message twice',async()=>{
 let invocations=0;
 const s=setup({dispatch:async x=>{invocations++;return {accepted:true,receiptRef:'receipt://factory-1',workId:x.workId,checkpointId:x.checkpointId};}});
 await s.runtime.intake(job);
 const first=await s.runtime.consume({attemptId:job.attemptId});
 assert.equal(first.status,'ACCEPTED');
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).duplicate,true);
 assert.equal(invocations,1);
 const r=await s.runtime.recordReadback({attemptId:job.attemptId,workId:job.workId,
  checkpointId:job.checkpointId,receiptRef:'receipt://factory-1',evidenceRef:'evidence://factory-1',
  verified:true,domainCompleted:false});
 assert.equal(r.record.state,'READBACK_VERIFIED');
 assert.equal(r.record.domainCompleted,false);
});
test('missing authorized route waits instead of pretending to dispatch',async()=>{
 const s=setup();await s.runtime.intake(job);
 const result=await s.runtime.consume({attemptId:job.attemptId});
 assert.equal(result.status,'WAITING_ROUTE');
 assert.equal((await s.store.get(job.attemptId)).reason,'AUTHORIZED_ROUTE_NOT_CONNECTED');
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).duplicate,true);
});
test('ambiguous provider outcome holds until verified readback, not replay',async()=>{
 let count=0;
 const s=setup({dispatch:async()=>{count++;throw new Error('network died after send');}});
 await s.runtime.intake(job);
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).status,'OUTCOME_UNKNOWN');
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).duplicate,true);
 assert.equal(count,1);
 await assert.rejects(()=>s.runtime.recordReadback({attemptId:job.attemptId,workId:job.workId,
  checkpointId:job.checkpointId,receiptRef:'receipt://ok',evidenceRef:'evidence://ok',verified:false}),/PIXIE_READBACK_UNVERIFIED/);
 const verified=await s.runtime.recordReadback({attemptId:job.attemptId,workId:job.workId,
  checkpointId:job.checkpointId,receiptRef:'receipt://ok',evidenceRef:'evidence://ok',verified:true});
 assert.equal(verified.record.receiptRef,'receipt://ok');
 assert.equal(verified.record.state,'READBACK_VERIFIED');
});
test('queue send failure preserves outbox for recovery, no Work recreation',async()=>{
 const s=setup({failQueue:true});
 assert.equal((await s.runtime.intake(job)).record.state,'WAITING_QUEUE');
 const recovered=createPixieDeliveryRuntime({store:s.store,queue:{send:async msg=>s.messages.push(msg)},clock:s.clock});
 const results=await recovered.recover();
 assert.equal(results.length,1);
 assert.equal((await s.store.get(job.attemptId)).state,'QUEUED');
 assert.equal(s.messages.length,1);
});
test('rejects mismatched readback and context',async()=>{
 const s=setup({dispatch:async x=>({accepted:true,receiptRef:'receipt://a',workId:x.workId,checkpointId:x.checkpointId})});
 await s.runtime.intake(job);await s.runtime.consume({attemptId:job.attemptId});
 await assert.rejects(()=>s.runtime.recordReadback({attemptId:job.attemptId,workId:'WORK-other',
  checkpointId:job.checkpointId,receiptRef:'receipt://a',evidenceRef:'evidence://a',verified:true}),/PIXIE_READBACK_UNVERIFIED/);
});

test('signed City factory boundary readback may confirm already queued attempt',async()=>{
 const s=setup();await s.runtime.intake(job);
 const result=await s.runtime.recordReadback({attemptId:job.attemptId,workId:job.workId,
  checkpointId:job.checkpointId,receiptRef:'receipt://factory-boundary',
  evidenceRef:'evidence://factory-boundary',verified:true,cityBoundaryVerified:true,domainCompleted:false});
 assert.equal(result.record.state,'READBACK_VERIFIED');
 assert.equal(result.record.domainCompleted,false);
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).duplicate,true);
});
test('untrusted claim cannot skip accepted boundary',async()=>{
 const s=setup();await s.runtime.intake(job);
 await assert.rejects(()=>s.runtime.recordReadback({attemptId:job.attemptId,workId:job.workId,
  checkpointId:job.checkpointId,receiptRef:'receipt://invalid',evidenceRef:'evidence://invalid',verified:true}),/PIXIE_READBACK_WRONG_STATE/);
});
test('conveyor keeps original cargo and records verified owner receipt in queue consumer',async()=>{
 const cargo={requestedResult:'Original requested result',inputRefs:['owner://input']};
 const s=setup({dispatch:async x=>{assert.deepEqual(x.payload,cargo);return {accepted:true,verified:true,
   receiptRef:'receipt://conveyor',evidenceRef:'evidence://conveyor',workId:x.workId,checkpointId:x.checkpointId,domainCompleted:false};}});
 await s.runtime.intake({...job,payload:cargo});
 assert.equal((await s.runtime.consume({attemptId:job.attemptId})).status,'READBACK_VERIFIED');
 assert.equal((await s.store.get(job.attemptId)).domainCompleted,false);
 await assert.rejects(()=>s.runtime.intake({...job,payload:{requestedResult:'Changed'}}),/PIXIE_ATTEMPT_COLLISION/);
});
test('route retries stop after five proven not-sent attempts',async()=>{
 const s=setup({dispatch:async()=>({notSent:true,reason:'DEVICE_NOT_PAIRED'})});
 await s.runtime.intake(job);
 for(let i=0;i<5;i++){await s.runtime.consume({attemptId:job.attemptId});await s.runtime.recover();}
 const row=await s.store.get(job.attemptId);
 assert.equal(row.state,'WAITING_ROUTE');assert.equal(row.retryCount,5);
 assert.equal(s.messages.length,5);
});
test('ambiguous transport reconciles stored receipt without executing again',async()=>{
 const s=setup({dispatch:async()=>{throw new Error('reply lost');}});
 await s.runtime.intake(job);await s.runtime.consume({attemptId:job.attemptId});
 const recovery=createPixieDeliveryRuntime({store:s.store,queue:s.queue,clock:s.clock,
  readback:async x=>({accepted:true,verified:true,workId:x.workId,checkpointId:x.checkpointId,
   receiptRef:'receipt://persisted',evidenceRef:'evidence://persisted'})});
 await recovery.recover();
 assert.equal((await s.store.get(job.attemptId)).state,'READBACK_VERIFIED');assert.equal(s.messages.length,1);
});
test('City proof of no send recovers the same uncertain job without inventing an attempt',async()=>{
 const s=setup({dispatch:async()=>{throw new Error('reply unavailable');}});
 await s.runtime.intake(job);await s.runtime.consume({attemptId:job.attemptId});
 const recovery=createPixieDeliveryRuntime({store:s.store,queue:s.queue,clock:s.clock,
  readback:async()=>({notSent:true,reason:'FACTORY_STATION_NOT_READY'})});
 await recovery.recover();
 assert.equal((await s.store.get(job.attemptId)).state,'QUEUED');
 assert.deepEqual(s.messages,[{attemptId:job.attemptId},{attemptId:job.attemptId}]);
});

test('Intelligence reads an existing attempt only and never queues or dispatches',async()=>{
 let dispatches=0,providerCalls=0;
 const s=setup({dispatch:async()=>{dispatches++;return {notSent:true,reason:'SHOULD_NOT_RUN'};}});
 await s.runtime.intake(job);
 const before={...await s.store.get(job.attemptId)},messageCount=s.messages.length;
 const intelligence=createPixieIntelligence({clock:s.clock,provider:async call=>{
  providerCalls++;
  assert.equal(call.work.workId,job.workId);
  assert.equal(JSON.stringify(call.evidence).includes('workPassRef'),false);
  return {summary:'Existing attempt remains queued.',findings:[{kind:'FACT',text:'Attempt is queued.',evidenceRefs:[`pixie://delivery/${job.attemptId}`]}],
   recommendation:'Wait for the existing route.',confidence:'PROBABLE',suggestedAction:'WAIT'};
 }});
 const runtime=createPixieDeliveryRuntime({store:s.store,queue:s.queue,dispatch:async()=>{dispatches++;},
  intelligence,clock:s.clock});
 const result=await runtime.assess({attemptId:job.attemptId,stage:'RESOLVE'});
 assert.equal(result.status,'SHADOW_PROPOSED');assert.equal(result.executed,false);
 assert.equal(result.runtimeDecision,'WAIT');assert.equal(result.workLifecycle,'NOT_ASSERTED');
 assert.equal(providerCalls,1);assert.equal(dispatches,0);assert.equal(s.messages.length,messageCount);
 assert.deepEqual(await s.store.get(job.attemptId),before);
});

test('evaluation keeps receipt separate from verified readback and domain completion',async()=>{
 let dispatches=0;
 const s=setup({dispatch:async x=>{dispatches++;return {accepted:true,receiptRef:'receipt://eval',
  workId:x.workId,checkpointId:x.checkpointId};}});
 await s.runtime.intake(job);await s.runtime.consume({attemptId:job.attemptId});
 const intelligence=createPixieIntelligence({clock:s.clock,provider:async call=>{
  assert.equal(call.stage,'EVALUATE');
  return {summary:'A boundary receipt does not establish domain completion.',
   findings:[{kind:'FACT',text:'The receipt is recorded.',evidenceRefs:[`pixie://delivery/${job.attemptId}`]}],
   recommendation:'Keep the Work open until owner-source readback.',confidence:'PROBABLE',suggestedAction:'HOLD_OPEN'};
 }});
 const runtime=createPixieDeliveryRuntime({store:s.store,queue:s.queue,intelligence,clock:s.clock});
 const receiptOnly=await runtime.assess({attemptId:job.attemptId,stage:'EVALUATE'});
 assert.equal(receiptOnly.completionAssessment,'RECEIPT_ONLY');
 assert.equal(receiptOnly.workLifecycle,'NOT_ASSERTED');
 await runtime.recordReadback({attemptId:job.attemptId,workId:job.workId,checkpointId:job.checkpointId,
  receiptRef:'receipt://eval',evidenceRef:'evidence://eval',verified:true,domainCompleted:false});
 const verifiedReadback=await runtime.assess({attemptId:job.attemptId,stage:'EVALUATE'});
 assert.equal(verifiedReadback.completionAssessment,'READBACK_ONLY_COMPLETION_NOT_PROVEN');
 assert.equal(verifiedReadback.runtimeDecision,'READBACK_ONLY_COMPLETION_NOT_PROVEN');
 assert.equal(dispatches,1);
});

test('Plan & Route reuses the existing capability planner and cannot switch routes',async()=>{
 const s=setup();await s.runtime.intake(job);
 const routeRegistry={FACTORY_STATION:{status:'READY',capabilities:['CODE'],capacity:2,active:1}};
 const intelligence=createPixieIntelligence({clock:s.clock,provider:async call=>{
  assert.equal(call.context.stationId,job.stationId);assert.equal(call.context.operation,job.operation);
  return {summary:'The existing route is eligible.',findings:[{kind:'FACT',text:'The current station supports this operation.',evidenceRefs:[`pixie://delivery/${job.attemptId}`]}],
   recommendation:'Keep the current authorized route.',confidence:'PROBABLE',suggestedAction:'KEEP_EXISTING_ROUTE'};
 }});
 const runtime=createPixieDeliveryRuntime({store:s.store,queue:s.queue,intelligence,routeRegistry,clock:s.clock});
 const before={...await s.store.get(job.attemptId)},messageCount=s.messages.length;
 const result=await runtime.assess({attemptId:job.attemptId,stage:'PLAN_ROUTE'});
 assert.equal(result.routePlan.action,'DISPATCH');
 assert.equal(result.routePlan.stationId,job.stationId);
 assert.equal(result.routePlan.operation,job.operation);
 assert.equal(result.runtimeDecision,'PRESERVE_EXISTING_ROUTE');
 assert.equal(result.executed,false);assert.deepEqual(await s.store.get(job.attemptId),before);
 assert.equal(s.messages.length,messageCount);
});
