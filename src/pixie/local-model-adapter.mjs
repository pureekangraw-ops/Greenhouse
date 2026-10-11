const MAX_RESPONSE_BYTES = 64 * 1024;
const CLIENTS = new Set(['PIXIE','DWARF']);
const STAGE=/^[A-Z][A-Z0-9_]{0,63}$/;
const WORK=/^WORK-[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const localModelLanes=new Map();
const isLoopback = host => ['localhost','127.0.0.1','::1','[::1]'].includes(host.toLowerCase());
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function validContext(context){
  if(context==null)return true;
  if(!isRecord(context))return false;
  try{return JSON.stringify(context).length<=8192;}catch{return false;}
}

function endpointUrl(endpoint) {
  if (typeof endpoint!=='string' || !endpoint.trim()) throw new TypeError('SHARED_LOCAL_MODEL_CONFIG_INVALID');
  let url;
  try { url=new URL(endpoint); } catch { throw new TypeError('SHARED_LOCAL_MODEL_CONFIG_INVALID'); }
  const loopbackHttp=url.protocol==='http:' && isLoopback(url.hostname);
  if ((url.protocol!=='https:' && !loopbackHttp) || url.username || url.password || url.search || url.hash)
    throw new TypeError('SHARED_LOCAL_MODEL_CONFIG_INVALID');
  const path=url.pathname.replace(/\/+$/,'');
  url.pathname=path.endsWith('/v1/chat/completions')?path:
    path.endsWith('/v1')?`${path}/chat/completions`:`${path}/v1/chat/completions`;
  return url;
}
async function withLocalModelSlot(key,signal,run){
  const previous=localModelLanes.get(key)||Promise.resolve();
  let release;
  const turn=new Promise(resolve=>{release=resolve;});
  const tail=previous.catch(()=>{}).then(()=>turn);
  localModelLanes.set(key,tail);
  return previous.catch(()=>{}).then(async()=>{
    try{
      if(signal?.aborted)throw new Error('SHARED_LOCAL_MODEL_CANCELLED');
      return await run();
    }finally{
      release();
      if(localModelLanes.get(key)===tail)localModelLanes.delete(key);
    }
  });
}

/**
 * Adapter for any owner-configured OpenAI-compatible local inference endpoint.
 * Endpoint/model are configuration, never caller input; no device hostname is fixed.
 */
export function createLocalModelAdapter({endpoint,model,apiKey=null,fetchImpl=globalThis.fetch}={}) {
  if (endpoint==null && model==null) return null;
  if (typeof model!=='string' || !model.trim() || model.trim().length>160 ||
      (apiKey!==null && (typeof apiKey!=='string' || apiKey.length>4096)) || typeof fetchImpl!=='function')
    throw new TypeError('SHARED_LOCAL_MODEL_CONFIG_INVALID');
  const url=endpointUrl(endpoint);
  const modelName=model.trim();
  return async function localModelProvider(call) {
    if (!isRecord(call) || !CLIENTS.has(call.client) || !STAGE.test(call.stage||'') ||
        typeof call.system!=='string' || !call.system.trim() || call.system.length>4000 ||
        typeof call.task!=='string' || !call.task.trim() || call.task.length>2000 ||
        !isRecord(call.work) || typeof call.work.workId!=='string' || !WORK.test(call.work.workId) ||
        typeof call.work.checkpointId!=='string' ||
        !call.work.checkpointId.startsWith(`${call.work.workId}:CP-`) ||
        (call.work.attemptId!=null&&(typeof call.work.attemptId!=='string'||!ID.test(call.work.attemptId))) ||
        (call.work.state!=null&&(typeof call.work.state!=='string'||call.work.state.length>128)) ||
        (call.work.observedAt!=null&&(typeof call.work.observedAt!=='string'||call.work.observedAt.length>64)) ||
        !validContext(call.context) ||
        !Array.isArray(call.evidence)||call.evidence.length<1||call.evidence.length>12||
        call.evidence.some(item=>!isRecord(item)||typeof item.ref!=='string'||!item.ref.trim()||
          item.ref.length>512||typeof item.excerpt!=='string'||!item.excerpt.trim()||item.excerpt.length>1200)||
        new Set(call.evidence.map(item=>item.ref)).size!==call.evidence.length)
      throw new TypeError('SHARED_LOCAL_MODEL_REQUEST_INVALID');
    const key=`${url.toString()}|${modelName}`;
    return withLocalModelSlot(key,call.signal,async()=>{
      const headers={'content-type':'application/json','accept':'application/json'};
      if (apiKey) headers.authorization=`Bearer ${apiKey}`;
      const response=await fetchImpl(url.toString(),{
        method:'POST',headers,signal:call.signal,
        body:JSON.stringify({model:modelName,temperature:0,stream:false,response_format:{type:'json_object'},
          messages:[{role:'system',content:call.system},{role:'user',content:JSON.stringify({client:call.client,
            stage:call.stage,task:call.task,work:call.work,context:call.context,evidence:call.evidence,
            fallback:call.fallback||null})}]}),
      });
      if (!response?.ok || typeof response.text!=='function') throw new Error('SHARED_LOCAL_MODEL_UNAVAILABLE');
      const raw=await response.text();
      if (raw.length>MAX_RESPONSE_BYTES) throw new Error('SHARED_LOCAL_MODEL_RESPONSE_TOO_LARGE');
      let envelope;
      try { envelope=JSON.parse(raw); } catch { throw new Error('SHARED_LOCAL_MODEL_RESPONSE_INVALID'); }
      const content=envelope?.choices?.[0]?.message?.content;
      if (typeof content!=='string' || content.length>MAX_RESPONSE_BYTES) throw new Error('SHARED_LOCAL_MODEL_RESPONSE_INVALID');
      try { return JSON.parse(content); } catch { throw new Error('SHARED_LOCAL_MODEL_OUTPUT_INVALID'); }
    });
  };
}
