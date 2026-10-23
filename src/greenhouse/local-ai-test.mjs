import {createAgent} from '../agents/runtime.mjs';

// The owner supplies an already-authorized provider function, not a browser URL.
// No network adapter, discovery, model download, queue, credential or ledger here.
export function createLocalAITestConnector({models,provider,now=Date.now,timeoutMs=8000}={}) {
 if(typeof provider!=='function'||!Array.isArray(models)||!models.length||models.length>20||
    models.some(model=>typeof model!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,100}$/.test(model))||new Set(models).size!==models.length)throw Error('CONNECTOR_CONFIG_INVALID');
 const allowed=Object.freeze([...models]);
 return Object.freeze({models:allowed,async test(input){
  if(!input||Object.keys(input).some(k=>!['model','text','syntheticOnly'].includes(k))||input.syntheticOnly!==true||
     !allowed.includes(input.model)||typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)throw Error('SYNTHETIC_TEST_INVALID');
  const started=now();
  const agent=createAgent({agent:'GENOME',mode:'SHOP',timeoutMs,provider:call=>provider({...call,model:input.model})});
  const result=await agent.respond({text:input.text,context:{}});
  return {reply:result.reply,modelStatus:result.modelStatus,model:input.model,elapsedMs:Math.max(0,now()-started),executed:false,syntheticOnly:true};
 }});
}
export async function handleLocalAITest(request,{connector=null,session=null}={}) {
 const reply=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
 if(!['GET','POST'].includes(request.method))return reply({code:'METHOD_NOT_ALLOWED'},405);
 const origin=new URL(request.url).origin;
 if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.get('origin')&&request.headers.get('origin')!==origin))return reply({code:'ORIGIN_DENIED'},403);
 if(!connector)return request.method==='GET'?reply({configured:false,models:[],state:'DISCONNECTED'}):reply({code:'LOCAL_AI_NOT_CONFIGURED'},503);
 if(typeof session?.actorId!=='string'||!session.actorId.trim()||typeof session.csrfToken!=='string'||!session.csrfToken)return reply({code:'OWNER_SESSION_REQUIRED'},401);
 if(request.method==='GET')return reply({configured:true,models:connector.models,state:'CONFIGURED_NOT_TESTED',csrfToken:session.csrfToken});
 if(request.headers.get('origin')!==origin||request.headers.get('x-csrf-token')!==session.csrfToken)return reply({code:'CSRF_REQUIRED'},403);
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return reply({code:'JSON_REQUIRED'},415);
 try{
  const raw=await request.text();if(new TextEncoder().encode(raw).length>8192)return reply({code:'REQUEST_TOO_LARGE'},413);
  let input;try{input=JSON.parse(raw);}catch{return reply({code:'SYNTHETIC_TEST_INVALID'},400);}
  try{return reply(await connector.test(input));}catch(error){return reply({code:error.message==='SYNTHETIC_TEST_INVALID'?'SYNTHETIC_TEST_INVALID':'LOCAL_AI_UNAVAILABLE'},error.message==='SYNTHETIC_TEST_INVALID'?400:502);}
 }catch{return reply({code:'LOCAL_AI_UNAVAILABLE'},502);}
}
