import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const source=await readFile((process.env.DEMO_PREVIEW_OUTPUT||'/tmp/greenhouse-demo-deployment')+'/_worker.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const server=createServer(async(req,res)=>{const response=await worker.fetch(new Request('http://127.0.0.1'+req.url,{method:req.method}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})});
try{
 const page=await browser.newPage({viewport:{width:360,height:800}}),errors=[],apis=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/')||r.url().includes('localhost:8000'))apis.push(r.url());});
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 await page.waitForFunction(()=>document.querySelectorAll('.tracking-row').length===3);
 assert.equal(await page.locator('#data-mode').inputValue(),'demo');
 assert.equal(await page.locator('#data-mode option[value="live"]').count(),0);
 assert.match(await page.locator('#tracking-state').textContent(),/DEMO/);
 assert.equal(await page.locator('#request-read-form').isVisible(),false);
 await page.locator('.tracking-row').first().click();
 assert.match(await page.locator('#event-detail').textContent(),/SYNTHETIC/);
 assert.deepEqual(errors,[]);assert.deepEqual(apis,[]);
 assert.equal((await page.request.get('http://127.0.0.1:'+server.address().port+'/api/greenhouse/tracking')).status(),404);
 console.log('PASS: built demo browser boots in explicit DEMO; 3 synthetic rows/detail; live/read API unavailable; zero source/device requests and uncaught errors');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
