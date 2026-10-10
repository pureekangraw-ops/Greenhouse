import test from 'node:test';
import assert from 'node:assert/strict';
import {createGreenhouseServer} from '../server.mjs';
import {EVENT_SCHEMA} from '../src/greenhouse/state-intelligence.mjs';
const ts=Date.parse('2026-10-10T05:00:00.000Z');
async function host(t,extra={}){
 const server=createGreenhouseServer({now:()=>ts,...extra});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 return 'http://127.0.0.1:'+server.address().port;
}
const event={
 schema:EVENT_SCHEMA,eventId:'event-1',workId:'WORK-123',checkpointId:'WORK-123:CP-01',
 attemptId:'ATT-1',stationId:'FACTORY_STATION',operation:'CODE',
 source:'PIXIE',state:'WAITING_ROUTE',observedAt:'2026-10-10T04:59:59.000Z',
 reason:'STATION_NOT_READY',
};
test('operational journal is not public and never invented when adapter is missing',async t=>{
 const base=await host(t);
 const response=await fetch(base+'/api/greenhouse/operations');
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{code:'OPERATIONS_READER_UNAVAILABLE'});
});
test('verified session reads journal and shows exact blocker without claiming completion',async t=>{
 let called;
 const base=await host(t,{ownerSessionResolver:async()=>({actorId:'GO'}),
  operationsReader:async x=>{called=x;return [event];}});
 const response=await fetch(base+'/api/greenhouse/operations?workId=WORK-123');
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(called.workId,'WORK-123');
 assert.equal(called.session.actorId,'GO');
 assert.equal(result.items[0].waitingOn,'ROUTE');
 assert.equal(result.items[0].blocker,'STATION_NOT_READY');
 assert.equal(result.items[0].hall,'UNKNOWN');
 assert.equal(result.counts.hallClosed,0);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
test('unauthenticated request does not call operational reader',async t=>{
 let calls=0;
 const base=await host(t,{ownerSessionResolver:async()=>null,
  operationsReader:async()=>{calls++;return [event];}});
 assert.equal((await fetch(base+'/api/greenhouse/operations')).status,401);
 assert.equal(calls,0);
});
test('bad journal and unexpected query keys fail closed',async t=>{
 const base=await host(t,{ownerSessionResolver:async()=>({actorId:'GO'}),
  operationsReader:async()=>[ {...event,checkpointId:'WORK-OTHER:CP-01'} ]});
 assert.equal((await fetch(base+'/api/greenhouse/operations?foo=x')).status,400);
 const bad=await fetch(base+'/api/greenhouse/operations');
 assert.equal(bad.status,502);
 assert.deepEqual(await bad.json(),{code:'OPERATION_JOURNAL_UNVERIFIED'});
});
