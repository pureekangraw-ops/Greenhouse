// Browser-only, fixed owner-reported device loopback. Never imported by server.
export const DEVICE_AI_BASE='http://localhost:8000/v1';
const failure=(code,reachable=false)=>Object.assign(new Error(code),{code,reachable});
export async function testDeviceAI({model,text,protocol,syntheticOnly,protocolConfirmed,signal,fetchImpl=fetch,timeoutMs=10000}={}) {
 if(protocol!=='chat-completions-compatible'||protocolConfirmed!==true||syntheticOnly!==true||
    typeof model!=='string'||!model.trim()||model.length>120||typeof text!=='string'||!text.trim()||text.length>2000)throw failure('DEVICE_CONFIG_REQUIRED');
 const controller=new AbortController();let timedOut=false;
 const cancel=()=>controller.abort();if(signal?.aborted)throw failure('CANCELLED');signal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
 let reachable=false;
 try{
  // Compatibility experiment, not an assertion that HERMES implements this API.
  // No model-list/discovery request, redirects, credentials, customer context or history.
  const response=await fetchImpl(DEVICE_AI_BASE+'/chat/completions',{
   method:'POST',mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
   headers:{'content-type':'application/json'},signal:controller.signal,
   body:JSON.stringify({model:model.trim(),messages:[{role:'user',content:text.trim()}],stream:false,max_tokens:256}),
  });
  reachable=true;
  if(!response.ok)throw failure('DEVICE_HTTP_'+response.status,true);
  const reader=response.body?.getReader();if(!reader)throw failure('DEVICE_PROTOCOL_UNVERIFIED',true);
  let raw='',size=0;const decoder=new TextDecoder();
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw failure('DEVICE_RESPONSE_TOO_LARGE',true);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
  let body;try{body=JSON.parse(raw);}catch{throw failure('DEVICE_PROTOCOL_UNVERIFIED',true);}
  const content=body?.choices?.[0]?.message?.content;
  if(typeof content!=='string'||!content.trim()||content.length>4000)throw failure('DEVICE_PROTOCOL_UNVERIFIED',true);
  return {reply:content,modelStatus:'RESPONDED',executed:false,reachable:true,model:model.trim(),syntheticOnly:true};
 }catch(error){
  if(controller.signal.aborted)throw failure(timedOut?'TIMEOUT':'CANCELLED',reachable);
  if(error.code?.startsWith('DEVICE_'))throw error;
  throw failure('DEVICE_BLOCKED_OR_UNREACHABLE',reachable);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
