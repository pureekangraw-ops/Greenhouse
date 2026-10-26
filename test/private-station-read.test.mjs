import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import * as mcpModule from '../src/hub/greenhouse-mcp.mjs';

const request=(name,args={})=>new Request('https://greenhouse.internal/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:17,method:'tools/call',params:{name,arguments:args}})});
const decoded=async response=>{assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.json();return {body,data:JSON.parse(body.result.content[0].text)};};
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`CREATE TABLE pixie_deliveries(delivery_id TEXT PRIMARY KEY,work_id TEXT NOT NULL,checkpoint_id TEXT NOT NULL,source_station TEXT NOT NULL,destination_station TEXT NOT NULL,operation TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','QUEUED','IN_TRANSIT','DELIVERED','RETURNED','FAILED','UNKNOWN')),cargo_ref TEXT,receipt_ref TEXT,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE pixie_delivery_events(event_id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL,event_type TEXT NOT NULL,evidence_ref TEXT,created_at TEXT NOT NULL);`);
 for(const file of ['001_pixie_operations.sql','002_pixie_payload.sql','003_pixie_delivery_state.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 for(const [id,actor,time,state] of [['a1','GO','2026-10-26T01:00:00Z','ACCEPTED'],['a2','LIGHT','2026-10-26T02:00:00Z','READBACK_VERIFIED']])sqlite.prepare(`INSERT INTO pixie_deliveries(delivery_id,work_id,checkpoint_id,source_station,destination_station,operation,status,idempotency_key,created_at,updated_at,actor,work_pass_ref,payload_json,delivery_state,receipt_ref,evidence_ref,domain_completed) VALUES (?,?,?,'CITY_HALL','FACTORY_STATION','CODE','DELIVERED',?,?,?,?,?,?,?,?,?,1)`).run(id,'WORK-1','WORK-1:CP-1',id,time,time,actor,'private-workpass','{"secret":"private-payload"}',state,'receipt-1','evidence-1');
 let reads=0;
 const db={prepare(sql){assert.match(sql,/^SELECT /);assert.doesNotMatch(sql,/\*|payload_json|work_pass_ref|\bactor\b/);reads++;const s=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this;},async first(){return s.get(...args)??null;},async all(){return {results:s.all(...args)};}};}};
 return {db,sqlite,reads:()=>reads};
}
test('private station read denies undeclared authority before touching storage, despite caller identity hints',async()=>{
 assert.equal(typeof mcpModule.createPrivateStationRead,'function');
 let touched=0;const db={prepare(){touched++;throw Error('must not read');}};
 const hinted=request('greenhouse_delivery_get',{attemptId:'a1'});hinted.headers.set('authorization','Bearer forged-owner');hinted.headers.set('x-owner-id','GO');
 const response=await mcpModule.createPrivateStationRead({db})(hinted);
 const {body,data}=await decoded(response);assert.equal(body.result.isError,true);assert.equal(data.code,'READ_NOT_AUTHORIZED');assert.equal(touched,0);
});
test('station capability reads actual ledger with explicit station scope, unresolved Work and no user owner inference',async()=>{
 assert.equal(typeof mcpModule.createPrivateStationRead,'function');
 const f=fixture();try{
 const handle=mcpModule.createPrivateStationRead({db:f.db,grantSource:'PRIVATE_SERVICE_BINDING'});
 const {data}=await decoded(await handle(request('greenhouse_delivery_list',{limit:1})));
 assert.deepEqual(data.scope,{kind:'STATION',stationId:'GREENHOUSE_STATION'});assert.equal(data.items.length,1);assert.equal(data.items[0].attemptId,'a2');assert.equal(data.coverage.complete,false);
 assert.deepEqual(data.items[0].workRef,{workId:'WORK-1',resolution:'UNRESOLVED'});
 const text=JSON.stringify(data);for(const hidden of ['private-workpass','private-payload','ownerId','LIGHT','domainCompleted'])assert.equal(text.includes(hidden),false);
 const exact=await decoded(await handle(request('greenhouse_delivery_get',{attemptId:'a1'})));assert.equal(exact.data.attemptId,'a1');assert.equal(exact.data.scope.kind,'STATION');
 const missing=await decoded(await handle(request('greenhouse_delivery_get',{attemptId:'missing'})));assert.equal(missing.data.availability,'NOT_FOUND');
 const result=await decoded(await handle(request('greenhouse_result_get',{attemptId:'a2'})));assert.equal(result.data.availability,'UNAVAILABLE');
 const before=f.reads();for(const args of [{limit:31},{ownerId:'GO'},{actor:'LIGHT'},{limit:1,sourceSystem:'other'}])assert.equal((await decoded(await handle(request('greenhouse_delivery_list',args)))).body.result.isError,true);assert.equal(f.reads(),before);
 }finally{f.sqlite.close();}
});
test('private station route refuses non-MCP paths, writes, query fields and oversized requests',async()=>{
 assert.equal(typeof mcpModule.createPrivateStationRead,'function');
 const handle=mcpModule.createPrivateStationRead();
 for(const [url,method,status] of [['https://greenhouse.internal/station/intake','POST',404],['https://greenhouse.internal/mcp','GET',405],['https://greenhouse.internal/mcp?ownerId=GO','POST',400]])assert.equal((await handle(new Request(url,{method}))).status,status);
 assert.equal((await handle(new Request('https://greenhouse.internal/mcp',{method:'POST',body:'x'.repeat(16385)}))).status,413);
 assert.equal((await handle(new Request('https://greenhouse.internal/mcp',{method:'POST',body:'{' }))).status,400);
});
