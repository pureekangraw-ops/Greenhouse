// Actual Pages bundle -> signed Access owner -> named private Worker -> local D1.
// All identities, grants and data below are local fixtures; no deployed requests.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname,basename,extname} from 'node:path';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{Miniflare,convertV4MiniflareOptions}=require(process.env.MINIFLARE_MODULE||'miniflare');
const root=fileURLToPath(new URL('../',import.meta.url));
const pages=resolve(process.argv[2]||'dist/pages/index.js'),source=resolve(process.argv[3]||'dist/read-entry.js');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture-key',alg:'RS256',use:'sig'};
const now=Math.floor(Date.now()/1000),encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const h=encode({alg:'RS256',kid:jwk.kid}),p=encode({iss:'https://fixture.cloudflareaccess.com',aud:['greenhouse-local-only'],email:'owner@example.test',sub:'fixture-owner-sub',exp:now+600});
const token=h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');
let uiWorker;const apiLog=[];
const server=createServer(async(req,res)=>{try{const response=await uiWorker.fetch('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers});if(req.url.startsWith('/api/'))apiLog.push({path:req.url,status:response.status});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(502);res.end('local fixture error');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const cfg={GREENHOUSE_UI_ORIGIN:origin,GREENHOUSE_ACCESS_TEAM_DOMAIN:'fixture.cloudflareaccess.com',GREENHOUSE_ACCESS_AUD:'greenhouse-local-only',GREENHOUSE_OWNER_EMAIL:'owner@example.test'};
const asset=async request=>{let path=new URL(request.url).pathname;if(path==='/greenhouse/')path+='index.html';if(!/^\/greenhouse\/[A-Za-z0-9._-]+$/.test(path))return new Response('not found',{status:404});try{return new Response(await readFile(root+path),{headers:{'content-type':({'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(path)]||'application/octet-stream'}});}catch{return new Response('not found',{status:404});}};
const outbound=async request=>{assert.equal(request.url,'https://fixture.cloudflareaccess.com/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};
const mf=new Miniflare(convertV4MiniflareOptions({workers:[
 {name:'ui',rootPath:dirname(pages),modules:true,scriptPath:basename(pages),compatibilityDate:'2026-10-10',bindings:cfg,outboundService:outbound,serviceBindings:{ASSETS:asset,GREENHOUSE_READ:{name:'source',entrypoint:'GreenhouseRead'}}},
 {name:'missingcap',rootPath:dirname(pages),modules:true,scriptPath:basename(pages),compatibilityDate:'2026-10-10',bindings:cfg,outboundService:outbound,serviceBindings:{ASSETS:asset}},
 {name:'source',rootPath:dirname(source),modules:true,scriptPath:basename(source),compatibilityDate:'2026-10-10',bindings:{GREENHOUSE_STATION_READ:'PRIVATE_SERVICE_BINDING'},d1Databases:{PIXIE_DB:'synthetic-pixie'}},
]}));
let browser;
try{
 await mf.ready;uiWorker=await mf.getWorker('ui');const db=await mf.getD1Database('PIXIE_DB','source');
 await db.exec(`CREATE TABLE pixie_deliveries(delivery_id TEXT PRIMARY KEY,work_id TEXT NOT NULL,checkpoint_id TEXT NOT NULL,source_station TEXT NOT NULL,destination_station TEXT NOT NULL,operation TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',cargo_ref TEXT,receipt_ref TEXT,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);CREATE TABLE pixie_delivery_events(event_id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL,event_type TEXT NOT NULL,evidence_ref TEXT,created_at TEXT NOT NULL);`);
 for(const file of ['001_pixie_operations.sql','002_pixie_payload.sql','003_pixie_delivery_state.sql'])await db.exec((await readFile(root+'migrations/'+file,'utf8')).replace(/^--.*$/gm,'').replace(/\n/g,' '));
 await db.prepare(`INSERT INTO pixie_deliveries(delivery_id,work_id,checkpoint_id,source_station,destination_station,operation,status,idempotency_key,created_at,updated_at,actor,work_pass_ref,payload_json,delivery_state) VALUES ('real-ledger-attempt','WORK-LOCAL','CP-LOCAL','CITY_HALL','FACTORY_STATION','CODE','DELIVERED','real-ledger-attempt','2026-10-26T00:00:00Z','2026-10-26T00:00:00Z','GO','private-workpass','{"secret":"private-payload"}','ACCEPTED')`).run();
 await db.prepare("INSERT INTO pixie_deliveries SELECT 'neighbor-ledger-attempt',work_id,checkpoint_id,source_station,destination_station,operation,status,cargo_ref,receipt_ref,'neighbor-ledger-attempt',created_at,updated_at,actor,work_pass_ref,queued_at,dispatched_at,readback_at,evidence_ref,reason,domain_completed,payload_json,retry_count,delivery_state FROM pixie_deliveries WHERE delivery_id='real-ledger-attempt'").run();
 const before=JSON.stringify((await db.prepare('SELECT * FROM pixie_deliveries').all()).results),headers={'cf-access-jwt-assertion':token};
 assert.equal((await uiWorker.fetch(origin+'/api/greenhouse/tracking')).status,401);
 assert.equal((await uiWorker.fetch(origin+'/api/greenhouse/tracking',{headers:{...headers,origin:'https://evil.test'}})).status,403);
 assert.equal((await (await mf.getWorker('missingcap')).fetch(origin+'/api/greenhouse/tracking',{headers})).status,503);
 const response=await uiWorker.fetch(origin+'/api/greenhouse/tracking',{headers});assert.equal(response.status,200);const data=await response.json();assert.equal(data.scope.kind,'STATION');assert.equal(data.items[0].workRef.resolution,'UNRESOLVED');assert.equal(data.items[0].result.availability,'UNAVAILABLE');assert.equal(JSON.stringify(data).includes('private-workpass'),false);
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
 const portable=process.env.CHROMIUM_MODULE?(await import(process.env.CHROMIUM_MODULE)).default:null;
 browser=await chromium.launch({headless:true,...(portable?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||await portable.executablePath(),args:portable.args.filter(arg=>!['--disable-web-security','--allow-running-insecure-content','--disable-site-isolation-trials','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--in-process-gpu'].includes(arg)).concat(['--disable-gpu','--use-gl=disabled'])}:process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})});
 for(const viewport of [{width:360,height:800},{width:1440,height:900}]){
  const context=await browser.newContext({viewport,serviceWorkers:'block',extraHTTPHeaders:headers});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/greenhouse/');await page.waitForFunction(()=>document.querySelectorAll('.tracking-row').length===2);
  assert.equal(await page.locator('#data-mode').inputValue(),'live');assert.match(await page.locator('.tracking-row').first().textContent(),/real-ledger-attempt.*STATION/s);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('.tracking-row').first().click();await page.waitForFunction(()=>document.querySelector('#detail-state')?.textContent.includes('อัปเดตข้อมูลรายการนี้แล้ว'));assert.match(await page.locator('#event-detail').textContent(),/UNRESOLVED/);assert.match(await page.locator('#event-detail').textContent(),/UNAVAILABLE/);
  // Race 1: a valid exact read already in flight must not outlive a list denial.
  let releaseDetail,detailSeen;const detailGate=new Promise(r=>releaseDetail=r),detailStarted=new Promise(r=>detailSeen=r);
  await page.route('**/api/greenhouse/tracking/item?**',async route=>{detailSeen();await detailGate;await route.continue({headers:route.request().headers()});});
  await page.locator('#item-refresh').click();await detailStarted;
  await page.locator('#event-detail [data-view="events"]').click();await context.setExtraHTTPHeaders({});await page.locator('#tracking-refresh').click();await page.waitForFunction(()=>document.querySelector('#tracking-state').textContent.includes('ยังไม่ยืนยัน'));
  const completed=page.waitForResponse(r=>r.url().includes('/tracking/item?'));releaseDetail();await completed;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.deepEqual(errors,[]);assert.equal(await page.locator('.tracking-row').count(),0);await page.unroute('**/api/greenhouse/tracking/item?**');
  // Restore the same genuine fixture authority and exercise a session denial.
  await context.setExtraHTTPHeaders(headers);await page.locator('#tracking-refresh').click();await page.waitForFunction(()=>document.querySelectorAll('.tracking-row').length===2);await page.locator('.tracking-row').first().click();await page.waitForFunction(()=>document.querySelector('#detail-state')?.textContent.includes('อัปเดตข้อมูลรายการนี้แล้ว'));
  // Race 2: an older valid list may not repopulate the station after detail401.
  let releaseList,listSeen;const listGate=new Promise(r=>releaseList=r),listStarted=new Promise(r=>listSeen=r);
  await page.route('**/api/greenhouse/tracking?limit=30',async route=>{listSeen();await listGate;await route.continue({headers:route.request().headers()});});
  await page.locator('#event-detail [data-view="events"]').click();await page.locator('#tracking-refresh').click();await listStarted;await page.locator('.tracking-row').first().click();await page.waitForFunction(()=>document.querySelector('#detail-state')?.textContent.includes('อัปเดตข้อมูลรายการนี้แล้ว'));
  await context.setExtraHTTPHeaders({});await page.locator('#item-refresh').click();await page.waitForFunction(()=>!document.querySelector('#item-refresh'));assert.doesNotMatch(await page.locator('#event-detail').textContent(),/real-ledger-attempt/);const listDone=page.waitForResponse(r=>r.url().includes('/tracking?limit='));releaseList();await listDone;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert.equal(await page.locator('.tracking-row').count(),0);assert.deepEqual(errors,[]);await context.close();
 }
 assert.equal(JSON.stringify((await db.prepare('SELECT * FROM pixie_deliveries').all()).results),before);
 assert.ok(apiLog.some(x=>x.path.startsWith('/api/greenhouse/tracking/item')&&x.status===200));assert.ok(apiLog.some(x=>x.status===401));
 console.log(JSON.stringify({result:'PASS',actualPagesBundle:true,realSignedOwnerSession:true,namedPrivateBinding:true,actualLocalD1:true,browserLiveListDetail:true,viewports:[360,1440],anonymousDenied:true,crossOriginDenied:true,missingCapabilityDenied:true,revocationPurgesAllStationRows:true,overlappingListDetailSafe:true,staleListCannotUndoDenial:true,workUnresolved:true,resultUnavailable:true,ledgerUnchanged:true,apiLog}));
}finally{if(browser)await browser.close();await mf.dispose();await new Promise(r=>server.close(r));}
