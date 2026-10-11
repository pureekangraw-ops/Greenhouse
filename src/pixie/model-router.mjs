const ROUTER_SCHEMA='SHARED_MODEL_ROUTER_RESULT_V1';
const CLIENTS=new Set(['PIXIE','DWARF']);
const WORK=/^WORK-[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STAGE=/^[A-Z][A-Z0-9_]{0,63}$/;
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function contextJson(context){
  if(context==null)return '{}';
  if(!isRecord(context))return null;
  try{
    const encoded=JSON.stringify(context);
    return typeof encoded==='string'&&encoded.length<=8192?encoded:null;
  }catch{return null;}
}

function result(status,source,output=null,reason=null){
  return Object.freeze({schema:ROUTER_SCHEMA,status,source,output,reason});
}
function validCall(call){
  if(!isRecord(call)||!CLIENTS.has(call.client)||!STAGE.test(call.stage||'')||
    typeof call.system!=='string'||!call.system.trim()||call.system.length>4000||
    typeof call.task!=='string'||!call.task.trim()||call.task.length>2000||
    !isRecord(call.work)||typeof call.work.workId!=='string'||!WORK.test(call.work.workId)||
    typeof call.work.checkpointId!=='string'||
    !call.work.checkpointId.startsWith(`${call.work.workId}:CP-`)||
    (call.work.attemptId!=null&&(typeof call.work.attemptId!=='string'||!ID.test(call.work.attemptId)))||
    (call.work.state!=null&&(typeof call.work.state!=='string'||call.work.state.length>128))||
    (call.work.observedAt!=null&&(typeof call.work.observedAt!=='string'||call.work.observedAt.length>64))||
    contextJson(call.context)===null||
    !Array.isArray(call.evidence)||call.evidence.length<1||call.evidence.length>12||
    call.evidence.some(item=>!isRecord(item)||typeof item.ref!=='string'||!item.ref.trim()||
      item.ref.length>512||typeof item.excerpt!=='string'||!item.excerpt.trim()||item.excerpt.length>1200))
    return false;
  return new Set(call.evidence.map(item=>item.ref)).size===call.evidence.length;
}
function scopedCall(call){
  const work={workId:call.work.workId,checkpointId:call.work.checkpointId};
  for(const key of ['attemptId','state','observedAt'])
    if(call.work[key]!=null)work[key]=call.work[key];
  return Object.freeze({
    client:call.client,stage:call.stage,system:call.system,task:call.task,
    work:Object.freeze(work),
    context:Object.freeze(JSON.parse(contextJson(call.context))),
    evidence:Object.freeze(call.evidence.map(item=>Object.freeze({ref:item.ref,excerpt:item.excerpt}))),
    signal:call.signal,
  });
}

function codedError(code){
  const error=new Error(code);
  error.code=code;
  return error;
}
async function runBounded(provider,call,timeoutMs,parentSignal,timeoutCode){
  if(parentSignal?.aborted)throw codedError('MODEL_ROUTER_CANCELLED');
  const controller=new AbortController();
  let timer,onAbort;
  const aborted=new Promise((_,reject)=>{
    onAbort=()=>{
      controller.abort();
      reject(codedError('MODEL_ROUTER_CANCELLED'));
    };
    parentSignal?.addEventListener?.('abort',onAbort,{once:true});
  });
  const timedOut=new Promise((_,reject)=>{
    timer=setTimeout(()=>{
      controller.abort();
      reject(codedError(timeoutCode));
    },timeoutMs);
  });
  try{
    return await Promise.race([
      Promise.resolve().then(()=>provider(Object.freeze({...call,signal:controller.signal}))),
      timedOut,
      aborted,
    ]);
  }finally{
    clearTimeout(timer);
    parentSignal?.removeEventListener?.('abort',onAbort);
  }
}
const monotonicNow=()=>globalThis.performance?.now?.()??Date.now();

/**
 * Shared Local-first inference router. Pass the same instance to PIXIE and
 * DWARF clients where they share a process; LocalModelAdapter also serializes
 * all requests to the same endpoint/model across adapter instances in an isolate.
 */
export function createSharedModelRouter({localProvider=null,lightProvider=null,
  shouldUseLocal=()=>true,localTimeoutMs=20000,totalTimeoutMs=28000,
  availabilityTimeoutMs=1000}={}){
  if(localProvider!==null&&typeof localProvider!=='function')throw new TypeError('MODEL_ROUTER_LOCAL_PROVIDER_INVALID');
  if(lightProvider!==null&&typeof lightProvider!=='function')throw new TypeError('MODEL_ROUTER_LIGHT_PROVIDER_INVALID');
  if(typeof shouldUseLocal!=='function'||!Number.isSafeInteger(localTimeoutMs)||localTimeoutMs<1||localTimeoutMs>30000||
    !Number.isSafeInteger(totalTimeoutMs)||totalTimeoutMs<1||totalTimeoutMs>30000||
    !Number.isSafeInteger(availabilityTimeoutMs)||availabilityTimeoutMs<1||availabilityTimeoutMs>5000)
    throw new TypeError('MODEL_ROUTER_CONFIG_INVALID');

  async function useLight(call,reason,remainingMs){
    if(call.signal?.aborted)throw new Error('MODEL_ROUTER_CANCELLED');
    if(!lightProvider)return result(localProvider?'FALLBACK_UNAVAILABLE':'NOT_CONFIGURED','NONE',null,
      localProvider?`${reason}_LIGHT_NOT_CONFIGURED`:'NO_MODEL_PROVIDER');
    if(remainingMs<=0)return result('TIMEOUT','NONE',null,'MODEL_ROUTER_TOTAL_TIMEOUT');
    const fallbackCall=Object.freeze({...call,fallback:Object.freeze({from:'LOCAL',reason})});
    try{
      const output=await runBounded(lightProvider,fallbackCall,remainingMs,call.signal,'LIGHT_TIMEOUT');
      return result('OK','LIGHT',output,reason);
    }catch(error){
      if(call.signal?.aborted)throw new Error('MODEL_ROUTER_CANCELLED');
      return error?.code==='LIGHT_TIMEOUT'
        ?result('TIMEOUT','NONE',null,'LIGHT_TIMEOUT')
        :result('FALLBACK_UNAVAILABLE','NONE',null,'LIGHT_UNAVAILABLE');
    }
  }

  return async function route(call){
    if(!validCall(call))throw new TypeError('MODEL_ROUTER_REQUEST_INVALID');
    if(call.signal?.aborted)throw new Error('MODEL_ROUTER_CANCELLED');
    const input=scopedCall(call);
    const deadline=monotonicNow()+totalTimeoutMs;
    const remaining=()=>Math.max(0,deadline-monotonicNow());
    if(!localProvider)return useLight(input,'LOCAL_NOT_CONFIGURED',remaining());
    let selected=true;
    let selectionReason='LOCAL_RESERVED_OR_BUSY';
    try{
      selected=await runBounded(async statusCall=>shouldUseLocal(statusCall),input,
        Math.min(availabilityTimeoutMs,remaining()),input.signal,'LOCAL_STATUS_TIMEOUT')!==false;
    }catch(error){
      if(input.signal?.aborted)throw new Error('MODEL_ROUTER_CANCELLED');
      selected=false;
      selectionReason=error?.code==='LOCAL_STATUS_TIMEOUT'?'LOCAL_STATUS_TIMEOUT':'LOCAL_STATUS_UNAVAILABLE';
    }
    if(remaining()<=0)return result('TIMEOUT','NONE',null,'MODEL_ROUTER_TOTAL_TIMEOUT');
    if(!selected)return useLight(input,selectionReason,remaining());

    const localBudget=Math.min(localTimeoutMs,remaining());
    try{
      const output=await runBounded(localProvider,input,localBudget,input.signal,'LOCAL_TIMEOUT');
      return result('OK','LOCAL',output,null);
    }catch(error){
      if(input.signal?.aborted)throw new Error('MODEL_ROUTER_CANCELLED');
      const reason=error?.code==='LOCAL_TIMEOUT'?'LOCAL_TIMEOUT':'LOCAL_UNAVAILABLE';
      return useLight(input,reason,remaining());
    }
  };
}

export const SHARED_MODEL_ROUTER_SCHEMA=ROUTER_SCHEMA;