import test from 'node:test';
import assert from 'node:assert/strict';
import {createPixieWorker} from '../src/pixie/transport-worker.mjs';
async function signature(secret,body,stamp){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(stamp+'.'+body)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function verifyRail(r,s,b){return r.headers.get('x-metropolis-greenhouse-signature')===await signature(s,b,r.headers.get('x-metropolis-greenhouse-timestamp'));}
async function railRequest(service,secret,path,input){const body=JSON.stringify(input),stamp=String(Date.now());return service.fetch(new Request('https://greenhouse.internal'+path,{method:'POST',body,headers:{'x-metropolis-greenhouse-timestamp':stamp,'x-metropolis-greenhouse-signature':await signature(secret,body,stamp)}}));}
test('ephemeral Observatory payload passes signed Greenhouse rail to Hall without queue or D1 retention',async()=>{
 let calls=0;const secret='test-rail';
 const city={async fetch(request){calls++;assert.equal(new URL(request.url).pathname,'/station/observatory-ingest');const body=await request.text();assert.equal(await verifyRail(request,secret,body),true);assert.equal(JSON.parse(body).path,'/observatory/device/00000000-0000-4000-8000-000000000000/snapshot');return Response.json({accepted:true,captureId:'c1'});}};
 const env={METROPOLIS_GREENHOUSE_RAIL_SECRET:secret,METROPOLIS_SERVICE:city};
 const green={fetch:r=>createPixieWorker().fetch(r,env)};
 const result=await railRequest(green,secret,'/station/observatory-forward',{path:'/observatory/device/00000000-0000-4000-8000-000000000000/snapshot',token:'station-token',body:'"'.repeat(44000)});
 assert.equal(result.status,200);assert.equal((await result.json()).captureId,'c1');assert.equal(calls,1);
});
test('unauthenticated forwarding cannot reach Hall',async()=>{
 let calls=0;const result=await createPixieWorker().fetch(new Request('https://greenhouse.internal/station/observatory-forward',{method:'POST',body:'"'.repeat(44000)}),{METROPOLIS_GREENHOUSE_RAIL_SECRET:'test',METROPOLIS_SERVICE:{fetch(){calls++;}}});
 assert.equal(result.status,401);assert.equal(calls,0);
});
