import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedModelRouter} from '../src/pixie/model-router.mjs';

const call=(overrides={})=>({
  client:'PIXIE',stage:'ANALYZE',system:'policy',task:'analyze',
  work:{workId:'WORK-1',checkpointId:'WORK-1:CP-01',attemptId:'ATT-1'},
  context:{state:'QUEUED'},evidence:[{ref:'evidence://1',excerpt:'bounded evidence'}],
  signal:new AbortController().signal,...overrides,
});

test('shared router selects Local first for both PIXIE and DWARF clients',async()=>{
  const calls=[];
  const route=createSharedModelRouter({localProvider:async value=>{calls.push(value);return {from:value.client};}});
  const pixie=await route(call({work:{workId:'WORK-1',checkpointId:'WORK-1:CP-01',attemptId:'ATT-1',
    state:'QUEUED',workPassRef:'must-not-leak'}}));
  const dwarf=await route(call({client:'DWARF',work:{workId:'WORK-2',checkpointId:'WORK-2:CP-02',attemptId:'ATT-2'}}));
  assert.equal(pixie.source,'LOCAL');assert.equal(pixie.output.from,'PIXIE');
  assert.equal(dwarf.source,'LOCAL');assert.equal(dwarf.output.from,'DWARF');
  assert.equal(calls.length,2);
  assert.equal('workPassRef' in calls[0].work,false);
});

test('Local failure falls back to LIGHT with the exact same Work scope and evidence',async()=>{
  let fallbackCall;
  const original=call();
  const route=createSharedModelRouter({
    localProvider:async()=>{throw new Error('local unavailable');},
    lightProvider:async value=>{fallbackCall=value;return {summary:'fallback result'};},
  });
  const result=await route(original);
  assert.equal(result.status,'OK');assert.equal(result.source,'LIGHT');
  assert.equal(result.reason,'LOCAL_UNAVAILABLE');
  assert.deepEqual(fallbackCall.work,original.work);
  assert.deepEqual(fallbackCall.context,original.context);
  assert.deepEqual(fallbackCall.evidence,original.evidence);
  assert.deepEqual(fallbackCall.fallback,{from:'LOCAL',reason:'LOCAL_UNAVAILABLE'});
});

test('trusted reservation/busy signal selects LIGHT without changing identity',async()=>{
  let localCalls=0,lightCall;
  const original=call({client:'DWARF'});
  const route=createSharedModelRouter({
    localProvider:async()=>{localCalls++;return {};},
    lightProvider:async value=>{lightCall=value;return {ok:true};},
    shouldUseLocal:async value=>{assert.equal(value.client,'DWARF');return false;},
  });
  const result=await route(original);
  assert.equal(localCalls,0);assert.equal(result.source,'LIGHT');
  assert.equal(result.reason,'LOCAL_RESERVED_OR_BUSY');
  assert.deepEqual(lightCall.work,original.work);
  assert.deepEqual(lightCall.evidence,original.evidence);
});

test('Local timeout aborts its request and fails over to LIGHT',async()=>{
  let localSignal,lightCalls=0;
  const route=createSharedModelRouter({
    localProvider:({signal})=>{localSignal=signal;return new Promise(()=>{});},
    lightProvider:async()=>{lightCalls++;return {ok:true};},
    localTimeoutMs:10,totalTimeoutMs:100,
  });
  const result=await route(call());
  assert.equal(localSignal.aborted,true);assert.equal(lightCalls,1);
  assert.equal(result.source,'LIGHT');assert.equal(result.reason,'LOCAL_TIMEOUT');
});

test('a late Local result is suppressed after timeout while LIGHT owns the result',async()=>{
  let releaseLocal,localSignal;
  const route=createSharedModelRouter({
    localProvider:({signal})=>{localSignal=signal;return new Promise(resolve=>{releaseLocal=resolve;});},
    lightProvider:async()=>({provider:'LIGHT'}),
    localTimeoutMs:10,totalTimeoutMs:100,
  });
  const result=await route(call());
  releaseLocal({provider:'LATE_LOCAL'});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(localSignal.aborted,true);
  assert.equal(result.source,'LIGHT');
  assert.deepEqual(result.output,{provider:'LIGHT'});
});

test('Local and LIGHT share one total budget; LIGHT is aborted at the deadline',async()=>{
  let lightSignal;
  const started=monotonicForTest();
  const route=createSharedModelRouter({
    localProvider:()=>new Promise(()=>{}),
    lightProvider:({signal})=>{lightSignal=signal;return new Promise(()=>{});},
    localTimeoutMs:30,totalTimeoutMs:90,availabilityTimeoutMs:10,
  });
  const result=await route(call());
  const elapsed=monotonicForTest()-started;
  assert.equal(result.status,'TIMEOUT');assert.equal(result.reason,'LIGHT_TIMEOUT');
  assert.equal(lightSignal.aborted,true);assert.ok(elapsed<250,`spent ${elapsed}ms`);
});

test('provider absence and unavailable fallback are explicit, not fabricated success',async()=>{
  const none=await createSharedModelRouter()(call());
  assert.equal(none.status,'NOT_CONFIGURED');assert.equal(none.source,'NONE');
  const noFallback=await createSharedModelRouter({localProvider:async()=>{throw Error();}})(call());
  assert.equal(noFallback.status,'FALLBACK_UNAVAILABLE');assert.equal(noFallback.source,'NONE');
  const failedFallback=await createSharedModelRouter({
    localProvider:async()=>{throw Error();},lightProvider:async()=>{throw Error();},
  })(call());
  assert.equal(failedFallback.status,'FALLBACK_UNAVAILABLE');
  assert.equal(failedFallback.reason,'LIGHT_UNAVAILABLE');
});

test('router rejects unknown callers and mismatched Work/checkpoint before inference',async()=>{
  let calls=0;
  const route=createSharedModelRouter({localProvider:async()=>{calls++;return {}; }});
  await assert.rejects(route(call({client:'OTHER'})),/MODEL_ROUTER_REQUEST_INVALID/);
  await assert.rejects(route(call({work:{workId:'WORK-1',checkpointId:'WORK-2:CP-01'}})),
    /MODEL_ROUTER_REQUEST_INVALID/);
  assert.equal(calls,0);
});

test('an already cancelled request is rejected before either model provider runs',async()=>{
  const controller=new AbortController();controller.abort();
  let localCalls=0,lightCalls=0;
  const route=createSharedModelRouter({
    localProvider:async()=>{localCalls++;return {};},
    lightProvider:async()=>{lightCalls++;return {};},
  });
  await assert.rejects(route(call({signal:controller.signal})),/MODEL_ROUTER_CANCELLED/);
  assert.equal(localCalls,0);assert.equal(lightCalls,0);
});

function monotonicForTest(){return globalThis.performance?.now?.()??Date.now();}