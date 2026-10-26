// Local integration/browser verification with explicit synthetic source ports.
// No live services, keys, Work grants, queues or executor are used.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createGreenhouseServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=process.env.UI_CHECK_OUTPUT||'/tmp/greenhouse-unified-ui';
await mkdir(output,{recursive:true});
const stamp='2026-10-26T12:00:00.000Z';
let availability='available',detailDenied=false,detailEmpty=false,reads=0;
const sourceItem=(source,value,dimension='DELIVERY')=>({ownerId:'synthetic-owner',ref:{sourceSystem:source,resourceType:'DELIVERY_ATTEMPT',resourceId:'same-id'},title:'งานทดสอบ '+source,statusFacts:[{dimension,value,sourceUpdatedAt:stamp,observedAt:stamp}],nextAction:'ตรวจข้อมูลจากต้นทาง',provenance:{sourceSystem:source,sourceRef:'same-id',observedAt:stamp,availability:'AVAILABLE'},result:{availability:'UNAVAILABLE'},links:[]});
const rows=[sourceItem('source-one','QUEUED'),sourceItem('source-two','RESPONDED','HUB_TRANSPORT')];
const session={actorId:'synthetic-owner',trackingScope:{ownerId:'synthetic-owner',sourceSystems:['source-one','source-two']}};
const trackingReader={async list(){reads++;return {ownerId:'synthetic-owner',observedAt:stamp,items:structuredClone(rows)};},async get({ref}){reads++;return {ownerId:'synthetic-owner',observedAt:stamp,items:detailEmpty?[]:rows.filter(x=>JSON.stringify(x.ref)===JSON.stringify(ref)).map(x=>structuredClone(x))};}};
const server=createGreenhouseServer({ownerSessionResolver:async request=>availability==='available'&&!(detailDenied&&request.url.includes('/tracking/item'))?session:null,trackingReader});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const portable=process.env.CHROMIUM_MODULE?await import(process.env.CHROMIUM_MODULE):null;
const chromiumProvider=portable?.default;
const browser=await chromium.launch({headless:true,...(chromiumProvider?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||await chromiumProvider.executablePath(),args:chromiumProvider.args}:process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})});
const results=[];
try{
 for(const viewport of [{width:360,height:800},{width:800,height:360},{width:768,height:1024},{width:1440,height:900}]){
  const context=await browser.newContext({viewport,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[],methods=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/'))methods.push(r.method());});
  availability='unavailable';detailDenied=false;detailEmpty=false;
  await page.goto(base+'/greenhouse/');
  if(process.env.UI_TEST_FONT_PATH){
   const bytes=await readFile(process.env.UI_TEST_FONT_PATH);
   await page.evaluate(async data=>{for(const name of ['Inter','Arial']){const font=new FontFace(name,new Uint8Array(data));await font.load();document.fonts.add(font);}await document.fonts.ready;},[...bytes]);
  }
  await page.waitForFunction(()=>document.querySelector('#tracking-state').textContent.includes('ยังไม่ยืนยัน'));
  assert.equal(await page.locator('.tracking-row').count(),0,'denied read must not become demo data');
  assert.equal(await page.locator('#data-mode').inputValue(),'live');
  availability='available';await page.locator('#tracking-refresh').click();
  await page.waitForFunction(()=>document.querySelectorAll('.tracking-row').length===2);
  assert.match(await page.locator('.tracking-row').first().textContent(),/คิวรอส่ง/);
  assert.doesNotMatch(await page.locator('.tracking-row').nth(1).textContent(),/Work เสร็จ/);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  assert.equal(overflow,false,'primary list must fit viewport');
  const touch=await page.locator('#tracking-refresh').boundingBox();assert.ok(touch.height>=44,'primary refresh touch target');
  await page.locator('#event-search').focus();assert.equal(await page.locator('#event-search').evaluate(el=>el===document.activeElement),true);
  await page.screenshot({path:output+'/list-'+viewport.width+'.png',fullPage:true});
  await page.locator('#event-search').fill('source-two');
  assert.equal(await page.locator('.tracking-row').count(),1);
  await page.locator('.tracking-row').click();
  await page.waitForFunction(()=>document.querySelector('#detail-state')?.textContent.includes('อัปเดตข้อมูลรายการนี้แล้ว'));
  assert.match(await page.locator('#event-detail').textContent(),/source-two/);
  assert.equal(await page.locator('#event-detail h2').textContent(),'งานทดสอบ source-two');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'detail must fit viewport');
  await page.screenshot({path:output+'/detail-'+viewport.width+'.png',fullPage:true});
  await page.locator('#event-detail [data-view="events"]').click();
  assert.equal(await page.locator('#event-search').inputValue(),'source-two');
  await page.locator('.tracking-row').click();
  await page.waitForFunction(()=>document.querySelector('#detail-state')?.textContent.includes('อัปเดตข้อมูลรายการนี้แล้ว'));
  detailDenied=true;await page.locator('#item-refresh').click();
  await page.waitForFunction(()=>!document.querySelector('#item-refresh'));
  assert.doesNotMatch(await page.locator('#event-detail').textContent(),/งานทดสอบ source-two/,'revoked read must clear old details');
  detailDenied=false;await page.locator('[data-view="events"]').first().click();
  await page.locator('#event-search').fill('');
  assert.equal(await page.locator('.tracking-row').count(),1,'deny removes only exact namespace item');
  await page.locator('#tracking-refresh').click();
  await page.waitForFunction(()=>document.querySelectorAll('.tracking-row').length===2);
  await page.locator('.tracking-row').first().click();
  await page.waitForFunction(()=>document.querySelector('#detail-state')?.textContent.includes('อัปเดตข้อมูลรายการนี้แล้ว'));
  detailEmpty=true;await page.locator('#item-refresh').click();
  await page.waitForFunction(()=>!document.querySelector('#item-refresh'));
  assert.doesNotMatch(await page.locator('#event-detail').textContent(),/งานทดสอบ source-one/,'empty exact lookup removes private details');
  detailEmpty=false;
  // Selected-request reader is an existing source-specific route. This fixture
  // isolates its DOM failure behavior; it is not producer authentication proof.
  let requestFailure=0;
  await page.route('**/api/greenhouse/requests/request-1',route=>route.fulfill({status:requestFailure||200,contentType:'application/json',body:JSON.stringify(requestFailure?{code:'SOURCE_DENIED'}:{items:[{title:'ข้อมูลคำขอส่วนตัวจำลอง',sourceEventId:'request-event-1',correlationId:'request-1',category:'REQUEST_SUBMITTED',ownerSource:'request-source',occurredAt:stamp,persistedAt:stamp,evidence:['private-evidence-ref'],receiptStatus:'MISSING',evidenceScope:'OWNER_HTTP_READBACK'}]})}));
  for(const status of [401,403,404]){
   requestFailure=0;await page.locator('[data-view="events"]').first().click();
   const reader=page.locator('.request-reader');if(!await reader.evaluate(el=>el.open))await reader.locator('summary').click();
   await page.locator('#request-id').fill('request-1');await page.locator('#read-request').click();
   await page.waitForFunction(()=>document.querySelector('#event-detail h2')?.textContent==='ข้อมูลคำขอส่วนตัวจำลอง');
   await page.locator('[data-view="events"]').first().click();
   requestFailure=status;await page.locator('#read-request').click();
   await page.waitForFunction(()=>!document.querySelector('#read-request').disabled);
   assert.doesNotMatch(await page.locator('body').textContent(),/ข้อมูลคำขอส่วนตัวจำลอง|private-evidence-ref/,'request form denial clears prior data: '+status);
  }
  await page.locator('#data-mode').selectOption('demo');
  assert.match(await page.locator('#data-banner').textContent(),/DEMO/);
  assert.equal(await page.locator('.tracking-row').count(),3);
  await page.locator('[data-view="settings"]').click();
  await page.locator('[data-view="ai"]').click();
  assert.equal(await page.locator('#ai-run').isDisabled(),true);
  assert.deepEqual(errors,[],'no uncaught browser errors');
  assert.ok(methods.every(m=>m==='GET'),'tracking workflow never mutates');
  results.push({viewport,passed:true,apiRequests:methods.length,uncaughtErrors:errors});
  await context.close();
 }
 const report={scope:'LOCAL_SYNTHETIC_SOURCE_HTTP_AND_BROWSER',reads,results,productionVerified:false};
 await writeFile(output+'/results.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
