import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,basename} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {Miniflare,convertV4MiniflareOptions}=require(process.env.MINIFLARE_MODULE || 'miniflare');
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=resolve(process.argv[2] || 'dist/read-entry.js');
const source={rootPath:dirname(bundle),modules:true,scriptPath:basename(bundle),compatibilityDate:'2026-10-10'};
const mf=new Miniflare(convertV4MiniflareOptions({workers:[
 {name:'caller',modules:true,script:`export default {fetch(request,env){return env.SOURCE.fetch(request)}}`,serviceBindings:{SOURCE:{name:'greenhouse',entrypoint:'GreenhouseRead'}}},
 {...source,name:'greenhouse',bindings:{GREENHOUSE_STATION_READ:'PRIVATE_SERVICE_BINDING'},d1Databases:{PIXIE_DB:'test-pixie'}},
 {...source,name:'ungranted',d1Databases:{PIXIE_DB:'test-pixie'}},
 {name:'denied-caller',modules:true,script:`export default {fetch(request,env){return env.SOURCE.fetch(request)}}`,serviceBindings:{SOURCE:{name:'ungranted',entrypoint:'GreenhouseRead'}}},
]}));
try{
 await mf.ready;
 const db=(await mf.getBindings('greenhouse')).PIXIE_DB;
 await db.exec(`CREATE TABLE pixie_deliveries(delivery_id TEXT PRIMARY KEY,work_id TEXT NOT NULL,checkpoint_id TEXT NOT NULL,source_station TEXT NOT NULL,destination_station TEXT NOT NULL,operation TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',cargo_ref TEXT,receipt_ref TEXT,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE TABLE pixie_delivery_events(event_id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL,event_type TEXT NOT NULL,evidence_ref TEXT,created_at TEXT NOT NULL);`);
 for(const file of ['001_pixie_operations.sql','002_pixie_payload.sql','003_pixie_delivery_state.sql']){
  const sql=readFileSync(root+'/migrations/'+file,'utf8').replace(/^--.*$/gm,'');
  // D1 exec expects each complete statement on one line, including triggers.
  await db.exec(sql.replace(/\n/g,' '));
 }
 await db.prepare(`INSERT INTO pixie_deliveries(delivery_id,work_id,checkpoint_id,source_station,destination_station,operation,status,idempotency_key,created_at,updated_at,actor,work_pass_ref,payload_json,delivery_state) VALUES ('a1','WORK-1','CP-1','CITY_HALL','FACTORY_STATION','CODE','DELIVERED','a1','2026-10-26T00:00:00Z','2026-10-26T00:00:00Z','GO','private-workpass','{"secret":"private-payload"}','ACCEPTED')`).run();
 const req=(name,args={})=>['https://greenhouse.internal/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}];
 const caller=await mf.getWorker('caller'),denied=await mf.getWorker('denied-caller');
 const d=await (await denied.fetch(...req('greenhouse_delivery_list'))).json();assert.equal(JSON.parse(d.result.content[0].text).code,'READ_NOT_AUTHORIZED');
 const before=JSON.stringify((await db.prepare('SELECT * FROM pixie_deliveries').all()).results);
 const list=await (await caller.fetch(...req('greenhouse_delivery_list'))).json();const data=JSON.parse(list.result.content[0].text);assert.equal(data.scope.kind,'STATION');assert.equal(data.items[0].attemptId,'a1');assert.equal(data.items[0].workRef.resolution,'UNRESOLVED');assert.equal(JSON.stringify(data).includes('private-workpass'),false);
 const result=await (await caller.fetch(...req('greenhouse_result_get',{attemptId:'a1'}))).json();assert.equal(JSON.parse(result.result.content[0].text).availability,'UNAVAILABLE');
 assert.equal((await (await mf.getWorker('greenhouse')).fetch(...req('greenhouse_delivery_list'))).status,503);
 assert.equal(JSON.stringify((await db.prepare('SELECT * FROM pixie_deliveries').all()).results),before);
 console.log(JSON.stringify({runtime:'local workerd via Miniflare',namedEntrypoint:'GreenhouseRead',deniedWithoutDeploymentGrant:true,stationProjection:true,workUnresolved:true,resultUnavailable:true,defaultHttpDoesNotExposeTools:true,ledgerUnchanged:true}));
}finally{await mf.dispose();}
