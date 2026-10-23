import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
let server;let base=process.env.DEMO_PREVIEW_URL;
if(!base){const source=await readFile('/tmp/greenhouse-demo-deployment/_worker.js','utf8');const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
 server=createServer(async(req,res)=>{const reply=await worker.fetch(new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers}));res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(await reply.text());});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;}
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let deviceCalls=0;await page.route('http://localhost:8000/**',route=>{deviceCalls++;return route.abort();});
 await page.goto(base+'/');await page.locator('#recent-events .event-row').first().waitFor();
 const commit=await page.locator('meta[name="greenhouse-preview-commit"]').getAttribute('content');
 assert.equal(await page.locator('#data-mode option').count(),1);assert.equal(await page.locator('#request-read-form').isVisible(),false);
 await page.locator('.workspace-nav [data-view="events"]').click();await page.locator('#event-search').fill('สไลด์');assert.equal(await page.locator('#event-results .event-row').count(),1);
 await page.locator('#event-results .event-row').click();assert.match(await page.locator('#event-detail').textContent(),/MISSING/);
 await page.locator('.workspace-nav [data-view="ai"]').click();assert.equal(await page.locator('#device-config').isVisible(),true);assert.equal(await page.locator('#ai-run').isDisabled(),true);assert.equal(await page.locator('#device-model').inputValue(),'');assert.equal(await page.locator('#device-protocol').inputValue(),'');assert.match(await page.locator('#device-config').textContent(),/OlliteRT/);
 await page.locator('#device-protocol').selectOption('chat-completions-compatible');await page.locator('#device-model').fill('synthetic-ui-only');await page.locator('#device-confirm').check();await page.locator('#ai-synthetic').check();assert.equal(await page.locator('#ai-run').isEnabled(),true); // Do not click: no real device inference authorized here.
 await page.locator('#device-model').fill('');assert.equal(await page.locator('#ai-run').isDisabled(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const version=await page.request.get(base+'/preview-version.json');assert.equal(version.status(),200);assert.equal((await version.json()).commit,commit);
 for(const path of ['/api/greenhouse/requests/synthetic-preview','/api/greenhouse/local-ai','/api/greenhouse/inbox']){const r=await page.request.get(base+path);assert.equal(r.status(),404);assert.equal((await r.json()).code,'PREVIEW_API_DISABLED');}
 assert.equal(deviceCalls,0);assert.deepEqual(errors,[]);
 await mkdir('/tmp/greenhouse-demo-verification',{recursive:true});await page.screenshot({path:'/tmp/greenhouse-demo-verification/device-panel.png',fullPage:true});
 console.log(JSON.stringify({url:base,commit,demoOnly:true,privilegedRoutesDisabled:true,mobileControls:true,deviceCalls,browserErrors:errors.length,actualInference:false}));
}finally{await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
