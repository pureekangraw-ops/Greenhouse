import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the actual browser module's registered event handlers. This small DOM
// surface stores rendered markup; full layout/browser behavior is verified separately.
function surface(){
 const nodes=new Map(),clicks=[];
 const node=selector=>{
  if(!nodes.has(selector))nodes.set(selector,{value:selector==='#data-mode'?'live':'',textContent:'',innerHTML:'',checked:false,disabled:false,hidden:false,dataset:{},listeners:new Map(),classList:{toggle(){}},focus(){},closest(){return this},setAttribute(){},removeAttribute(){},addEventListener(type,fn){this.listeners.set(type,fn)}});
  return nodes.get(selector);
 };
 return {node,document:{querySelector:node,querySelectorAll:()=>[],addEventListener(type,fn){if(type==='click')clicks.push(fn)}},click(selector,data){for(const fn of clicks)fn({target:{closest:query=>query===selector?{dataset:data}:null}})}};
}
const stamp='2026-10-26T12:00:00.000Z';
const neighbor={ref:{sourceSystem:'neighbor',resourceType:'BUSINESS_REQUEST',resourceId:'request-1'},title:'Neighbor request',statusFacts:[],nextAction:null,provenance:{sourceSystem:'neighbor',sourceRef:'neighbor-event',observedAt:null,availability:'AVAILABLE'},result:{availability:'UNAVAILABLE'},links:[]};
const envelope={schema:'greenhouse.tracking.v1',observedAt:null,coverage:{kind:'RECENT_WINDOW',complete:false,total:null},items:[neighbor]};
const event={title:'Private request title',ownerSource:'owner-source',sourceEventId:'private-event',correlationId:'request-1',category:'REQUEST_SUBMITTED',occurredAt:stamp,persistedAt:stamp,evidence:['private-evidence-ref'],receiptStatus:'MISSING',evidenceScope:'OWNER_HTTP_READBACK'};

test('request form re-read purges only previously loaded exact request on 401, 403 or 404; outage marks stale',async(t)=>{
 const saved={document:globalThis.document,window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,fetch:globalThis.fetch};
 try{
  for(const status of [401,403,404,502])await t.test(String(status),async()=>{
   const ui=surface();let responseStatus=200;
   globalThis.document=ui.document;globalThis.window={scrollY:0,scrollTo(){}};globalThis.requestAnimationFrame=fn=>fn();
   globalThis.fetch=async url=>{
    if(url==='/api/greenhouse/tracking?limit=30')return Response.json(envelope);
    if(url==='/api/greenhouse/local-ai')return Response.json({configured:false,models:[]});
    assert.equal(url,'/api/greenhouse/requests/request-1');
    return Response.json(responseStatus===200?{items:[event]}:{code:'UNAVAILABLE'},{status:responseStatus});
   };
   await import('../greenhouse/workspace.mjs?request-read-regression='+status);
   await new Promise(resolve=>setImmediate(resolve));
   ui.node('#request-id').value='request-1';
   const submit=ui.node('#request-read-form').listeners.get('submit');
   await submit({preventDefault(){}});
   assert.match(ui.node('#event-detail').innerHTML,/Private request title/);
   assert.match(ui.node('#event-detail').innerHTML,/private-evidence-ref/);
   ui.click('[data-view]',{view:'events'});
   responseStatus=status;await submit({preventDefault(){}});
   if(status===502){
    assert.match(ui.node('#event-results').innerHTML,/Private request title/);
    assert.match(ui.node('#read-message').textContent,/เก่า/);
   }else{
    assert.doesNotMatch(ui.node('#event-results').innerHTML,/Private request title/);
    assert.doesNotMatch(ui.node('#event-detail').innerHTML,/Private request title|private-evidence-ref/);
    assert.match(ui.node('#event-results').innerHTML,/Neighbor request/);
    ui.click('[data-view]',{view:'detail'});
    assert.doesNotMatch(ui.node('#event-detail').innerHTML,/Private request title|private-evidence-ref/);
   }
  });
 }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});

test('mode change releases request button while an obsolete read is pending and old cleanup cannot release a newer read',async()=>{
 const saved={document:globalThis.document,window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,fetch:globalThis.fetch};
 const ui=surface(),pending=[];
 try{
  globalThis.document=ui.document;globalThis.window={scrollY:0,scrollTo(){}};globalThis.requestAnimationFrame=fn=>fn();
  globalThis.fetch=async url=>{
   if(url==='/api/greenhouse/tracking?limit=30')return Response.json(envelope);
   if(url==='/api/greenhouse/local-ai')return Response.json({configured:false,models:[]});
   assert.equal(url,'/api/greenhouse/requests/request-1');
   return new Promise(resolve=>pending.push(resolve));
  };
  await import('../greenhouse/workspace.mjs?request-mode-generation-regression');
  await new Promise(resolve=>setImmediate(resolve));
  ui.node('#request-id').value='request-1';
  const submit=ui.node('#request-read-form').listeners.get('submit'),change=ui.node('#data-mode').listeners.get('change');
  const oldRead=submit({preventDefault(){}});
  assert.equal(ui.node('#read-request').disabled,true);
  ui.node('#data-mode').value='demo';change();
  assert.equal(ui.node('#read-request').disabled,false,'changing mode releases the obsolete request generation');
  ui.node('#data-mode').value='live';change();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.node('#read-request').disabled,false,'returning LIVE keeps the retained reader usable');
  const newRead=submit({preventDefault(){}});
  assert.equal(ui.node('#read-request').disabled,true);
  pending[0](Response.json({items:[event]}));await oldRead;
  assert.equal(ui.node('#read-request').disabled,true,'old finally must not release the newer active read');
  assert.doesNotMatch(ui.node('#event-detail').innerHTML,/Private request title/,'old result must remain superseded');
  pending[1](Response.json({items:[event]}));await newRead;
  assert.equal(ui.node('#read-request').disabled,false);
  assert.match(ui.node('#event-detail').innerHTML,/Private request title/);
 }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
