// Consume GO's existing authenticated endpoint; never write requests or list customers.
const OWNER_ORIGIN = 'https://yggmetro.com';
const id = value => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,120}$/.test(value);
const eventId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const fail = (code, status) => { throw Object.assign(new Error(code), {code,status}); };

export async function readOwnerRequest({requestId, authorization, fetchImpl = fetch, now = Date.now} = {}) {
  if (!id(requestId)) fail('REQUEST_ID_INVALID',400);
  if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]{32,200}$/.test(authorization)) fail('OWNER_AUTH_REQUIRED',401);
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),8000);
  try {
    // Fixed destination prevents caller-controlled credential forwarding/SSRF.
    const response = await fetchImpl(OWNER_ORIGIN+'/api/v1/admin/requests/'+encodeURIComponent(requestId), {
      method:'GET', headers:{authorization,accept:'application/json'},
      redirect:'error',cache:'no-store',signal:controller.signal,
    });
    if ([401,403].includes(response.status)) fail('OWNER_AUTH_REQUIRED',response.status);
    if (!response.ok && response.status !== 404) fail('REQUEST_OWNER_UNAVAILABLE',502);
    if (response.status === 404 && !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '')) fail('REQUEST_OWNER_INVALID',502);
    const reader=response.body?.getReader();if(!reader)fail('REQUEST_OWNER_INVALID',502);
    let size=0,raw='';const decoder=new TextDecoder();
    try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();fail('REQUEST_OWNER_TOO_LARGE',502);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();}
    finally {reader.releaseLock();}
    let body;try {body=JSON.parse(raw);}catch{fail('REQUEST_OWNER_INVALID',502);}
    if (response.status === 404) {
      // GO authenticates this admin endpoint before owned() emits this exact
      // error. A generic proxy/router 404 is not evidence of authentication.
      if (!body || Array.isArray(body) || body.ok !== false || body.code !== 'REQUEST_NOT_FOUND' ||
          Object.keys(body).length !== 2) fail('REQUEST_OWNER_INVALID',502);
      throw Object.assign(new Error('REQUEST_NOT_FOUND'), {code:'REQUEST_NOT_FOUND',status:404,ownerResponseVerified:true});
    }
    if(body?.ok!==true || body.request?.request_id!==requestId || !Array.isArray(body.events) || body.events.length>1000) fail('REQUEST_OWNER_INVALID',502);
    const submitted=body.events.filter(e=>e?.kind==='STATUS'&&e.from_value==='DRAFT'&&e.to_value==='SUBMITTED');
    // An ambiguous source must not become two apparent submissions.
    if(submitted.length!==1)fail('REQUEST_SUBMISSION_UNVERIFIED',409);
    const e=submitted[0];
    if(!eventId(e.event_id)||e.actor_type!=='CUSTOMER'||typeof e.timestamp!=='string'||!Number.isFinite(Date.parse(e.timestamp)))fail('REQUEST_OWNER_INVALID',502);
    return {items:[{
      title:'Request submitted',ownerSource:OWNER_ORIGIN,sourceEventId:e.event_id,
      correlationId:requestId,category:'REQUEST_SUBMITTED',occurredAt:e.timestamp,persistedAt:e.timestamp,
      observedAt:e.timestamp,freshness:'UNKNOWN',confidence:'OWNER_READBACK',
      evidence:['ygg_request_events:'+e.event_id],evidenceScope:'OWNER_HTTP_READBACK',
      receiptId:null,receiptStatus:'MISSING',
    }],observedAt:new Date(now()).toISOString(),nextCursor:null,execution:'NOT_ASSERTED'};
  } catch(error) {
    if(error.code && error.status)throw error;
    fail('REQUEST_OWNER_UNAVAILABLE',502);
  } finally {clearTimeout(timer);}
}

// Existing GO admin bearer is validated by GO on every read. This route creates
// no session, token, authority grant or secret binding and never logs credentials.
export async function handleOwnerRequestRead(request, requestId, options = {}) {
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
  const reply=(body,status)=>Response.json(body,{status,headers});
  if(request.method!=='GET')return reply({code:'READ_ONLY'},405);
  const origin=new URL(request.url).origin;
  if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.get('origin')&&request.headers.get('origin')!==origin))return reply({code:'ORIGIN_DENIED'},403);
  if(new URL(request.url).search)return reply({code:'QUERY_NOT_ALLOWED'},400);
  try{return reply(await readOwnerRequest({requestId,authorization:request.headers.get('authorization'),...options}),200);}
  catch(error){return reply({code:error.code||'REQUEST_OWNER_UNAVAILABLE',...(error.ownerResponseVerified === true ? {ownerResponseVerified:true} : {})},error.status||502);}
}
