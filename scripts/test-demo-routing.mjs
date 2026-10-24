import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const out=process.env.DEMO_PREVIEW_OUTPUT||'/tmp/greenhouse-demo-deployment';
const source=await readFile(out+'/_worker.js','utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
const request=(path,method='GET')=>worker.fetch(new Request('https://demo.invalid'+path,{method}));
const root=await request('/');
assert.equal(root.status,200);
const html=await root.text();
assert.match(html,/<title>Greenhouse · Android demo preview<\/title>/);
for(const path of ['/greenhouse/','/greenhouse/index.html']){
 const response=await request(path);assert.equal(response.status,200);assert.equal(await response.text(),html);
}
const redirect=await request('/greenhouse');
assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'/greenhouse/');
assert.equal((await request('/','HEAD')).status,200);
assert.equal(await (await request('/','HEAD')).text(),'');
assert.equal((await request('/','POST')).status,405);
assert.equal((await request('/unknown')).status,404);
for(const path of ['/api/greenhouse/requests/synthetic-routing-test','/api/greenhouse/local-ai','/api/greenhouse/inbox']){
 for(const method of ['GET','POST']){
  const response=await request(path,method);assert.equal(response.status,404);
  assert.equal((await response.json()).code,'PREVIEW_API_DISABLED');
 }
}
const hub=await readFile(new URL('../index.html',import.meta.url),'utf8');
assert.match(hub,/<title>Metropolis · Genome Hub<\/title>/);
assert.match(hub,/href="\/greenhouse\/"/);
console.log('PASS: demo root/aliases, canonical redirect, HEAD, method/unknown/API rejection; source Genome Hub and workspace link preserved');
