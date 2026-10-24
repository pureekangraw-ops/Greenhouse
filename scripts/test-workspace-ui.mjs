import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createGreenhouseServer} from '../server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const server=createGreenhouseServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const output=new URL('../docs/workspace-ui/screenshots/',import.meta.url).pathname;await mkdir(output,{recursive:true});
const context=await browser.newContext({viewport:{width:1440,height:1080},serviceWorkers:'block'});
const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
let externalRequests=0;
await context.route('**/*',route=>{if(!route.request().url().startsWith(base+'/')){externalRequests++;return route.abort();}return route.continue();});
const nav=name=>page.locator('.workspace-nav [data-view="'+name+'"]');
try{
 await page.goto(base+'/greenhouse/');await page.locator('#ai-state').getByText('DISCONNECTED',{exact:true}).waitFor({state:'attached'});
 assert.match(await page.locator('#data-banner').textContent(),/DEMO/);assert.equal(await page.locator('#visible-count').textContent(),'3');
 await page.screenshot({path:output+'01-overview-desktop.png',fullPage:true});
 await nav('events').click();assert.equal(await page.locator('#event-results .event-row').count(),3);
 await page.locator('#event-search').fill('สไลด์');assert.equal(await page.locator('#event-results .event-row').count(),1);
 await page.locator('#event-search').fill('');await page.locator('#category-filter').selectOption('REVIEW_NOTE');assert.equal(await page.locator('#event-results .event-row').count(),1);
 await page.locator('#source-filter').selectOption('demo-shop');assert.equal(await page.locator('#event-results .event-row').count(),0);
 await page.locator('#category-filter').selectOption('');await page.locator('#source-filter').selectOption('');
 await page.screenshot({path:output+'02-events-desktop.png',fullPage:true});
 await page.locator('#event-results [data-event="demo-event-001"]').click();assert.equal(await page.locator('.timeline li').count(),2);assert.match(await page.locator('#event-detail').textContent(),/MISSING/);
 await page.screenshot({path:output+'03-detail-desktop.png',fullPage:true});
 await page.locator('#data-mode').selectOption('live');assert.match(await page.locator('#event-detail').textContent(),/เลือกรายการ/);
 await nav('overview').click();assert.equal(await page.locator('#visible-count').textContent(),'—');assert.match(await page.locator('#recent-events').textContent(),/ยังไม่มีผลอ่านกลับจริง/);
 await nav('events').click();await page.locator('#request-id').fill('synthetic-greenhouse-ui');await page.locator('#read-request').click();await page.locator('#read-message').getByText(/ต้องเชื่อมตัวอ่าน/).waitFor();
 // UI protocol fixture only; no live source or credentials are involved.
 await page.route('**/api/greenhouse/requests/synthetic-greenhouse-ui',route=>route.fulfill({json:{items:[{title:'Synthetic UI fixture',sourceEventId:'fixture-001',correlationId:'synthetic-greenhouse-ui',category:'REQUEST_SUBMITTED',ownerSource:'https://source.invalid',occurredAt:'2026-10-23T09:00:00Z',persistedAt:'2026-10-23T09:00:00Z',evidence:['fixture://001'],receiptStatus:'MISSING',evidenceScope:'OWNER_HTTP_READBACK'}]}}));
 await page.locator('#read-request').click();await page.locator('#event-detail').getByText('fixture-001',{exact:true}).waitFor();assert.equal(await page.locator('.timeline li').count(),1);
 await nav('ai').click();assert.equal(await page.locator('#ai-run').isDisabled(),true);assert.equal(await page.locator('#ai-model').isDisabled(),true);
 await page.locator('#data-mode').selectOption('demo');
 await page.screenshot({path:output+'04-local-ai-disconnected.png',fullPage:true});
 await page.locator('#ai-route').selectOption('device');assert.equal(await page.locator('#ai-run').isDisabled(),true);assert.match(await page.locator('#ai-state').textContent(),/PROTOCOL UNVERIFIED/);
 await page.screenshot({path:output+'07-device-loopback-unverified.png',fullPage:true});
 await page.locator('#ai-route').selectOption('provider');await page.locator('#ai-state').getByText('DISCONNECTED',{exact:true}).waitFor();
 await page.locator('#data-mode').selectOption('live');
 // Inject same-origin API test responses, never an actual model endpoint.
 await page.route('**/api/greenhouse/local-ai',route=>route.request().method()==='GET'?route.fulfill({json:{configured:true,models:['synthetic-test-provider'],csrfToken:'synthetic-csrf'}}):route.fulfill({json:{reply:'Synthetic test reply',modelStatus:'RESPONDED',executed:false}}));
 await page.locator('#ai-refresh').click();await page.locator('#ai-state').getByText('CONFIGURED · NOT TESTED',{exact:true}).waitFor();
 assert.equal(await page.locator('#ai-run').isDisabled(),true);await page.locator('#ai-synthetic').check();assert.equal(await page.locator('#ai-run').isEnabled(),true);
 await page.locator('#ai-run').click();await page.locator('#ai-output').getByText('Synthetic test reply',{exact:true}).waitFor();assert.match(await page.locator('#ai-time').textContent(),/\d+ ms/);
 await page.route('**/api/greenhouse/local-ai',route=>route.fulfill({json:{reply:'Synthetic policy fallback',modelStatus:'UNAVAILABLE',executed:false}}));
 await page.locator('#ai-run').click();await page.locator('#ai-result-status').getByText(/คำตอบสำรอง/).waitFor();
 await page.route('**/api/greenhouse/local-ai',route=>route.fulfill({status:503,json:{code:'TEST_ERROR'}}));
 await page.locator('#ai-run').click();await page.locator('#ai-result-status').getByText(/ERROR/).waitFor();
 await page.locator('#ai-clear').click();assert.equal(await page.locator('#ai-input').inputValue(),'');assert.equal(await page.locator('#ai-synthetic').isChecked(),false);
 await nav('events').click();assert.equal(await page.locator('#event-results .event-row').count(),1);
 assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});
 await page.unroute('**/api/greenhouse/local-ai');await nav('ai').click();await page.locator('#ai-refresh').click();await page.locator('#ai-state').getByText('DISCONNECTED',{exact:true}).waitFor();
 await page.locator('#data-mode').selectOption('demo');await nav('overview').click();await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:output+'05-overview-mobile.png',fullPage:true});
 for(const name of ['overview','events','detail','ai']){await nav(name).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'no mobile horizontal overflow: '+name);}
 await page.screenshot({path:output+'06-local-ai-mobile.png',fullPage:true});
 assert.equal(externalRequests,0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({views:4,search:true,filters:true,detailHistory:true,liveEmpty:true,readbackAuthError:true,selectedReadbackFixture:true,aiDisconnected:true,aiConfiguredFixture:true,aiReplyFixture:true,aiErrorFixture:true,clear:true,mobileWidths:[390],externalRequests,browserErrors:errors.length,storageEntries:0,screenshots:7,deviceConfiguredButNotCalled:true,liveModelTested:false}));
}finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
