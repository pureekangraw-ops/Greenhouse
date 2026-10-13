// Server-side provider availability registry. No inference is claimed without an actual call.
const ID=/^[a-z][a-z0-9_-]{1,63}$/;
export function createProviderRegistry({clock=()=>new Date().toISOString()}={}) {
  const providers=new Map();
  function register({id,kind,invoke,health}) {
    if(!ID.test(id||'')||!['LOCAL','CLOUD'].includes(kind)||typeof invoke!=='function'||typeof health!=='function'||providers.has(id))
      throw new Error('PROVIDER_REGISTRATION_INVALID');
    providers.set(id,{kind,invoke,health});
  }
  async function status(id) {
    const provider=providers.get(id);
    if(!provider)return {id,status:'UNKNOWN',reason:'PROVIDER_NOT_REGISTERED'};
    try {
      const result=await provider.health();
      return {id,kind:provider.kind,status:result?.ready===true?'READY':'UNAVAILABLE',
        reason:result?.ready===true?null:'PROVIDER_NOT_READY',observedAt:clock()};
    } catch {return {id,kind:provider.kind,status:'UNAVAILABLE',reason:'HEALTH_CHECK_FAILED',observedAt:clock()};}
  }
  async function infer({id,input,cloudApproved=false}={}) {
    const provider=providers.get(id);
    if(!provider)return {status:'UNKNOWN',reason:'PROVIDER_NOT_REGISTERED',executed:false};
    if(provider.kind==='CLOUD'&&cloudApproved!==true)return {status:'DENIED',reason:'CLOUD_APPROVAL_REQUIRED',executed:false};
    const ready=await status(id);
    if(ready.status!=='READY')return {status:'UNAVAILABLE',reason:ready.reason,executed:false};
    try {
      const output=await provider.invoke(structuredClone(input));
      if(output===undefined)return {status:'UNKNOWN',reason:'EMPTY_PROVIDER_OUTPUT',executed:false};
      return {status:'RETURNED',providerId:id,executed:true,output};
    } catch {return {status:'UNKNOWN',reason:'PROVIDER_EXECUTION_FAILED',executed:false};}
  }
  return Object.freeze({register,status,infer});
}
