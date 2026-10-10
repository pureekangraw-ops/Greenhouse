import test from 'node:test';
import assert from 'node:assert/strict';
import runtime from './transport.mjs';

const request = (path, method='GET', body) => new Request('https://greenhouse.invalid'+path,{method,headers:{authorization:'Bearer test-secret'},...(body?{body:JSON.stringify(body),headers:{authorization:'Bearer test-secret','content-type':'application/json'}}:{})});
const base = {METROPOLIS_GREENHOUSE_TRANSPORT_SECRET:'test-secret',PIXIE_DB:{},PIXIE_DELIVERY_QUEUE:{}};
test('health fails closed without downstream runtime configuration',async()=>{
 const response=await runtime.fetch(request('/station/health'),base);
 assert.equal(response.status,503);
 assert.equal((await response.json()).status,'NOT_READY');
});
test('cannot enqueue before downstream is configured',async()=>{
 const response=await runtime.fetch(request('/station/receive','POST',{transportId:'t1',workId:'w1',checkpointId:'c1',targetStation:'FACTORY_STATION',operation:'FACTORY_HANDOFF',workPassRef:'p1',actingActor:'GO'}),base);
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,'DOWNSTREAM_NOT_CONFIGURED');
});
test('unauthorized requests fail closed',async()=>{
 const response=await runtime.fetch(new Request('https://greenhouse.invalid/station/health'),base);
 assert.equal(response.status,401);
});
test('health does not equate queue bindings to verified delivery',async()=>{
 const response=await runtime.fetch(request('/station/health'),{...base,FACTORY_RUNTIME_URL:'https://factory.invalid',METROPOLIS_FACTORY_RAIL_SECRET:'secret'});
 assert.equal(response.status,200);
 assert.equal((await response.json()).status,'READY');
});
