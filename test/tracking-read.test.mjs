import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createGreenhouseServer} from '../server.mjs';
import {handleTrackingRead} from '../src/greenhouse/tracking-read.mjs';
const session={actorId:'owner',trackingScope:{ownerId:'owner',sourceSystems:['greenhouse']}};
const ref={sourceSystem:'greenhouse',resourceType:'DELIVERY_ATTEMPT',resourceId:'a1'};
const row=()=>({ownerId:'owner',ref:{...ref},title:'Delivery',statusFacts:[{dimension:'DELIVERY',value:'OUTCOME_UNKNOWN',sourceUpdatedAt:null,observedAt:null}],nextAction:null,provenance:{sourceSystem:'greenhouse',sourceRef:'a1',observedAt:null,availability:'AVAILABLE'},result:{availability:'UNAVAILABLE'},links:[],payload:{secret:'hidden'},workPass:'secret'});
const reader={list:async()=>({ownerId:'owner',observedAt:null,items:[row()]}),get:async()=>({ownerId:'owner',observedAt:null,items:[row()]})};
const call=(query='',options={})=>handleTrackingRead(new Request('http://localhost/api/greenhouse/tracking'+query),{reader,session,...options});
test('tracking denies absent integration and absent verified scoped session before data',async()=>{
 assert.equal((await call('',{reader:null})).status,503);
 assert.equal((await call('',{session:null})).status,401);
 assert.equal((await call('',{session:{actorId:'owner'}})).status,403);
});
test('tracking rejects caller scope, duplicated params, invalid limits and methods',async()=>{
 for(const query of ['?actor=other','?limit=1&limit=2','?limit=31','?limit=0','?limit=1.0']) assert.equal((await call(query)).status,400);
 assert.equal((await handleTrackingRead(new Request('http://localhost/api/greenhouse/tracking',{method:'POST'}))).status,405);
});
test('tracking projects bounded source facts and redacts raw payload without freshening unknown timestamps',async()=>{
 const response=await call('?limit=1'); assert.equal(response.status,200);const data=await response.json();
 assert.equal(data.schema,'greenhouse.tracking.v1');assert.equal(data.observedAt,null);assert.deepEqual(data.coverage,{kind:'RECENT_WINDOW',complete:false,total:null});
 assert.equal(data.items[0].statusFacts[0].sourceUpdatedAt,null); assert.equal(JSON.stringify(data).includes('secret'),false);
 assert.equal(data.items[0].result.availability,'UNAVAILABLE');
});
test('tracking rejects whole malformed, overlimit, cross-owner and cross-source readbacks',async()=>{
 for(const alter of [r=>{r.ownerId='other'},r=>{r.ref.sourceSystem='other'},r=>{r.statusFacts[0].value='arbitrary'},r=>{r.title='Bearer sk-secret'},r=>{r.result={availability:'AVAILABLE',receiptRef:'r',evidenceRef:'e'}},r=>{r.links=['https://evil']}]){
  const item=row();alter(item);assert.equal((await call('',{reader:{list:async()=>({ownerId:'owner',observedAt:null,items:[item]})}})).status,502);
 }
 assert.equal((await call('?limit=1',{reader:{list:async()=>({ownerId:'owner',observedAt:null,items:[row(),row()]})}})).status,502);
});
test('tracking exact lookup preserves namespace and rejects wrong returned id',async()=>{
 const query='?sourceSystem=greenhouse&resourceType=DELIVERY_ATTEMPT&resourceId=a1';
 assert.equal((await handleTrackingRead(new Request('http://localhost/api/greenhouse/tracking/item'+query),{reader,session,item:true})).status,200);
 assert.equal((await handleTrackingRead(new Request('http://localhost/api/greenhouse/tracking/item'+query.replace('a1','a2')),{reader,session,item:true})).status,502);
 assert.equal((await handleTrackingRead(new Request('http://localhost/api/greenhouse/tracking/item'+query.replace('greenhouse&','other&')),{reader,session,item:true})).status,403);
});
test('actual Node routes enforce session, method, query and same origin without mutation ports',async(t)=>{
 const server=createGreenhouseServer({ownerSessionResolver:async()=>session,trackingReader:reader,hubCommandSubmitter:()=>{throw Error('READ_MUTATED')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(base+'/api/greenhouse/tracking')).status,200);
 assert.equal((await fetch(base+'/api/greenhouse/tracking/item?sourceSystem=greenhouse&resourceType=DELIVERY_ATTEMPT&resourceId=a1')).status,200);
 assert.equal((await fetch(base+'/api/greenhouse/tracking',{method:'POST'})).status,405);
 assert.equal((await fetch(base+'/api/greenhouse/tracking',{headers:{origin:'http://evil'}})).status,403);
});
test('tracking retains unavailable source facts and validates exact result proof without fetching refs',async()=>{
 const item=row();item.provenance.availability='UNAVAILABLE';
 const source={list:async()=>({ownerId:'owner',observedAt:null,items:[item]})};
 assert.equal((await (await call('',{reader:source})).json()).items[0].provenance.availability,'UNAVAILABLE');
 item.result={availability:'AVAILABLE',receiptRef:'r1',evidenceRef:'e1',verification:{verified:true,sourceRef:'a1',ref:{...ref}}};
 assert.equal((await (await call('',{reader:source})).json()).items[0].result.receiptRef,'r1');
 item.result.verification.ref.resourceId='a2';assert.equal((await call('',{reader:source})).status,502);
});
test('Pages tracking routes remain fail closed despite caller-supplied environment functions',async()=>{
 const load=async path=>{
  const code=(await readFile(new URL(path,import.meta.url),'utf8')).replace(/from '[^']*tracking-read.mjs'/, 'from '+JSON.stringify(new URL('../src/greenhouse/tracking-read.mjs',import.meta.url).href));
  return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 };
 const {onRequest}=await load('../functions/api/greenhouse/tracking.js');
 const {onRequest:onItem}=await load('../functions/api/greenhouse/tracking/item.js');
 let invoked=false;const env={trackingReader:()=>{invoked=true},ownerSessionResolver:()=>session};
 assert.equal((await onRequest({request:new Request('http://example/api/greenhouse/tracking'),env})).status,503);
 assert.equal((await onItem({request:new Request('http://example/api/greenhouse/tracking/item?sourceSystem=greenhouse&resourceType=DELIVERY_ATTEMPT&resourceId=a1'),env})).status,503);
 assert.equal(invoked,false);
});

test('empty authorized exact HTTP read returns non-disclosing 404 and removes only its prior model item',async(t)=>{
 const {acceptTracking,itemsAfterReadFailure}=await import('../greenhouse/workspace-model.mjs');
 let missing=false;
 const source={...reader,get:async()=>({ownerId:'owner',observedAt:null,items:missing?[]:[row()]})};
 const server=createGreenhouseServer({ownerSessionResolver:async()=>session,trackingReader:source});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+'/api/greenhouse/tracking/item?'+new URLSearchParams(ref);
 const loaded=acceptTracking(await (await fetch(url)).json(),ref).items;
 const neighbor={...loaded[0],ref:{...ref,sourceSystem:'neighbor'}};
 missing=true;const response=await fetch(url);
 assert.equal(response.status,404);assert.deepEqual(await response.json(),{code:'NOT_FOUND'});
 assert.deepEqual(itemsAfterReadFailure([...loaded,neighbor],ref,response.status),[neighbor]);
 // Missing applies only after a valid authorized source envelope, never to malformed data.
 assert.equal((await handleTrackingRead(new Request(url),{reader:{get:async()=>({ownerId:'other',observedAt:null,items:[]})},session,item:true})).status,502);
});
test('tracking list rejects duplicate typed identity before UI but preserves equal IDs across source namespaces',async()=>{
 const second=row();second.title='Conflicting private title';
 const scopedSession={...session,trackingScope:{...session.trackingScope,sourceSystems:['greenhouse','other']}};
 const source={list:async()=>({ownerId:'owner',observedAt:null,items:[row(),second]})};
 const denied=await call('',{reader:source,session:scopedSession});
 assert.equal(denied.status,502);assert.deepEqual(await denied.json(),{code:'TRACKING_READBACK_INVALID'});
 second.ref.sourceSystem='other';second.provenance.sourceSystem='other';
 const accepted=await call('',{reader:source,session:scopedSession});assert.equal(accepted.status,200);
 assert.deepEqual((await accepted.json()).items.map(i=>i.ref.sourceSystem),['greenhouse','other']);
});
