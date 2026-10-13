import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderRegistry} from '../src/agents/provider-registry.mjs';
test('unregistered provider is unknown, never successful',async()=>{
 const r=createProviderRegistry();assert.equal((await r.infer({id:'missing'})).executed,false);
});
test('local provider requires health and executes only when ready',async()=>{
 const r=createProviderRegistry();let calls=0;let ready=false;
 r.register({id:'hermes_local',kind:'LOCAL',health:async()=>({ready}),invoke:async input=>{calls++;return input;}});
 assert.equal((await r.infer({id:'hermes_local',input:{text:'hello'}})).status,'UNAVAILABLE');
 ready=true;assert.equal((await r.infer({id:'hermes_local',input:{text:'hello'}})).status,'RETURNED');
 assert.equal(calls,1);
});
test('cloud provider requires explicit approval',async()=>{
 const r=createProviderRegistry();let calls=0;
 r.register({id:'cloud_fallback',kind:'CLOUD',health:async()=>({ready:true}),invoke:async()=>{calls++;return 'ok';}});
 assert.equal((await r.infer({id:'cloud_fallback'})).reason,'CLOUD_APPROVAL_REQUIRED');
 assert.equal(calls,0);
});
test('provider errors do not fabricate success',async()=>{
 const r=createProviderRegistry();
 r.register({id:'offline',kind:'LOCAL',health:async()=>{throw Error('offline');},invoke:async()=>1});
 assert.equal((await r.infer({id:'offline'})).status,'UNAVAILABLE');
});
