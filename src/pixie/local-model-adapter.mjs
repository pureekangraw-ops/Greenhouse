const MAX_RESPONSE_BYTES = 64 * 1024;
const validStage = new Set(['ANALYZE','PLAN_ROUTE','RESOLVE','EVALUATE']);
const isLoopback = host => ['localhost','127.0.0.1','::1','[::1]'].includes(host.toLowerCase());

function endpointUrl(endpoint) {
  if (typeof endpoint!=='string' || !endpoint.trim()) throw new TypeError('PIXIE_LOCAL_MODEL_CONFIG_INVALID');
  let url;
  try { url=new URL(endpoint); } catch { throw new TypeError('PIXIE_LOCAL_MODEL_CONFIG_INVALID'); }
  const loopbackHttp=url.protocol==='http:' && isLoopback(url.hostname);
  if ((url.protocol!=='https:' && !loopbackHttp) || url.username || url.password || url.search || url.hash)
    throw new TypeError('PIXIE_LOCAL_MODEL_CONFIG_INVALID');
  const path=url.pathname.replace(/\/+$/,'');
  url.pathname=path.endsWith('/v1/chat/completions')?path:
    path.endsWith('/v1')?`${path}/chat/completions`:`${path}/v1/chat/completions`;
  return url;
}

/**
 * Adapter for any owner-configured OpenAI-compatible local inference endpoint.
 * Endpoint/model are configuration, never caller input; no device hostname is fixed.
 */
export function createLocalModelAdapter({endpoint,model,apiKey=null,fetchImpl=globalThis.fetch}={}) {
  if (endpoint==null && model==null) return null;
  if (typeof model!=='string' || !model.trim() || model.trim().length>160 ||
      (apiKey!==null && (typeof apiKey!=='string' || apiKey.length>4096)) || typeof fetchImpl!=='function')
    throw new TypeError('PIXIE_LOCAL_MODEL_CONFIG_INVALID');
  const url=endpointUrl(endpoint);
  const modelName=model.trim();
  return async function localModelProvider(call) {
    if (!call || !validStage.has(call.stage) || typeof call.system!=='string' ||
        !call.work || !Array.isArray(call.evidence)) throw new TypeError('PIXIE_LOCAL_MODEL_REQUEST_INVALID');
    const headers={'content-type':'application/json','accept':'application/json'};
    if (apiKey) headers.authorization=`Bearer ${apiKey}`;
    const response=await fetchImpl(url.toString(),{
      method:'POST',headers,signal:call.signal,
      body:JSON.stringify({model:modelName,temperature:0,stream:false,response_format:{type:'json_object'},
        messages:[{role:'system',content:call.system},{role:'user',content:JSON.stringify({stage:call.stage,
          task:call.task,work:call.work,context:call.context,evidence:call.evidence})}]}),
    });
    if (!response?.ok || typeof response.text!=='function') throw new Error('PIXIE_LOCAL_MODEL_UNAVAILABLE');
    const raw=await response.text();
    if (raw.length>MAX_RESPONSE_BYTES) throw new Error('PIXIE_LOCAL_MODEL_RESPONSE_TOO_LARGE');
    let envelope;
    try { envelope=JSON.parse(raw); } catch { throw new Error('PIXIE_LOCAL_MODEL_RESPONSE_INVALID'); }
    const content=envelope?.choices?.[0]?.message?.content;
    if (typeof content!=='string' || content.length>MAX_RESPONSE_BYTES) throw new Error('PIXIE_LOCAL_MODEL_RESPONSE_INVALID');
    try { return JSON.parse(content); } catch { throw new Error('PIXIE_LOCAL_MODEL_OUTPUT_INVALID'); }
  };
}
