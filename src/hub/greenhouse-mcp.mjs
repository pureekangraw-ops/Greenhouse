import {opaque,timestamp} from '../greenhouse/tracking-read.mjs';
const attemptId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const STATES=new Set(['PENDING_QUEUE','WAITING_QUEUE','QUEUED','DISPATCHING','WAITING_ROUTE','OUTCOME_UNKNOWN','ACCEPTED','READBACK_VERIFIED']);
const coverage=()=>({kind:'RECENT_WINDOW',complete:false,total:null});
const tools=[
 {name:'greenhouse_delivery_list',description:'Read a bounded owner-scoped recent window of delivery attempts.',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1,maximum:30}},additionalProperties:false}},
 ...['greenhouse_delivery_get','greenhouse_result_get'].map(name=>({name,description:'Read exact authorized attempt '+(name.includes('result')?'source result evidence.':'delivery facts.'),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:{type:'object',properties:{attemptId:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$',maxLength:128}},required:['attemptId'],additionalProperties:false}})),
];
function project(row,scope,expectedId){
 if(!row||row.ownerId!==scope.ownerId||!scope.sourceSystems.includes(row.sourceSystem)||!opaque(row.sourceSystem)||!attemptId(row.attemptId)||(expectedId&&row.attemptId!==expectedId)||!opaque(row.workId)||!opaque(row.checkpointId)||!opaque(row.stationId)||!opaque(row.operation)||!STATES.has(row.state)||!timestamp(row.receivedAt??null)||!timestamp(row.readbackAt??null))throw Error('SOURCE_READBACK_INVALID');
 for(const key of ['receiptRef','evidenceRef'])if(row[key]!=null&&!opaque(row[key]))throw Error('SOURCE_READBACK_INVALID');
 return {sourceSystem:row.sourceSystem,attemptId:row.attemptId,workRef:{workId:row.workId,resolution:'UNRESOLVED'},checkpointId:row.checkpointId,stationId:row.stationId,operation:row.operation,state:row.state,receivedAt:row.receivedAt??null,readbackAt:row.readbackAt??null,receiptRef:row.receiptRef??null,evidenceRef:row.evidenceRef??null};
}
/** Explicit integration ports (no runtime binding installed):
 * authorizeRead({context,tool,args}) -> {authorized:true,scope:{ownerId,sourceSystems}}.
 * Scope is derived from verified owner authority, never the MCP arguments.
 * The authorizer MUST narrow sourceSystems to exactly one producer namespace:
 * attemptId-only tools cannot distinguish same IDs across multiple sources.
 * Tracking HTTP/UI scopes may aggregate multiple namespaces using typed refs.
 * reader.list({scope,limit}) MUST filter in the producer before LIMIT;
 * reader.get({scope,attemptId}) MUST verify owner before returning exact record.
 * Each row must attest ownerId and sourceSystem; raw D1 overview is not a scoped list.
 * resultResolver({scope,attempt}) reads source evidence only, and returns a verified
 * proof matching that existing attempt's source/attempt/Work/checkpoint/receipt/evidence.
 * No port may dispatch, recover, submit, retry, cancel, mutate or fetch opaque refs.
 */
export function createGreenhouseMcp({reader=null,authorizeRead=null,resultResolver=null}={}){
 return async function handle(request,context=null){
  const response=result=>({jsonrpc:'2.0',id:request?.id??null,result});
  const error=(code,message)=>({jsonrpc:'2.0',id:request?.id??null,error:{code,message}});
  const content=(data,isError=false)=>response({content:[{type:'text',text:JSON.stringify(data)}],...(isError?{isError:true}:{})});
  if(!request||request.jsonrpc!=='2.0'||typeof request.method!=='string')return error(-32600,'Invalid request');
  if(request.method==='notifications/initialized'&&!('id' in request))return null;
  if(request.method==='initialize')return response({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'greenhouse-read',version:'1.0.0'}});
  if(request.method==='tools/list')return response({tools:structuredClone(tools)});
  if(request.method!=='tools/call')return error(-32601,'Method not found');
  const name=request.params?.name,args=request.params?.arguments;
  if(!tools.some(t=>t.name===name)||!args||typeof args!=='object'||Array.isArray(args))return content({code:'READ_ARGUMENTS_INVALID'},true);
  const list=name==='greenhouse_delivery_list';
  if(list ? (Object.keys(args).some(key=>key!=='limit') || (Object.hasOwn(args,'limit')&&(!Number.isSafeInteger(args.limit)||args.limit<1||args.limit>30))) : (Object.keys(args).length!==1||!attemptId(args.attemptId)))return content({code:'READ_ARGUMENTS_INVALID'},true);
  try{
   if(typeof authorizeRead!=='function')return content({code:'READ_NOT_AUTHORIZED'},true);
   const auth=await authorizeRead({context,tool:name,args:{...args}}),scope=auth?.scope;
   if(auth?.authorized!==true||!opaque(scope?.ownerId)||!Array.isArray(scope.sourceSystems)||scope.sourceSystems.length!==1||!scope.sourceSystems.every(opaque))return content({code:'READ_NOT_AUTHORIZED'},true);
   if(!reader||typeof reader[list?'list':'get']!=='function')return content({code:'READER_UNAVAILABLE'},true);
   if(list){
    const limit=args.limit??30;
    const rows=await reader.list({scope,limit});
    if(!Array.isArray(rows)||rows.length>limit)throw Error('SOURCE_READBACK_INVALID');
    const items=rows.map(row=>project(row,scope));
    const keys=items.map(row=>JSON.stringify([row.sourceSystem,row.attemptId]));
    if(new Set(keys).size!==keys.length)throw Error('SOURCE_READBACK_INVALID');
    return content({coverage:coverage(),items});
   }
   const row=await reader.get({scope,attemptId:args.attemptId});
   if(row===null)return content({availability:'NOT_FOUND'});
   const attempt=project(row,scope,args.attemptId);
   if(name==='greenhouse_delivery_get')return content(attempt);
   if(!resultResolver)return content({attemptId:attempt.attemptId,availability:'UNAVAILABLE'});
   const proof=await resultResolver({scope,attempt:structuredClone(attempt)});
   if(proof===null)return content({attemptId:attempt.attemptId,availability:'UNAVAILABLE'});
   if(proof?.verified!==true||proof.sourceSystem!==row.sourceSystem||proof.attemptId!==row.attemptId||proof.workId!==row.workId||proof.checkpointId!==row.checkpointId||proof.stationId!==row.stationId||proof.operation!==row.operation||!opaque(row.receiptRef)||!opaque(row.evidenceRef)||proof.receiptRef!==row.receiptRef||proof.evidenceRef!==row.evidenceRef||typeof proof.domainCompleted!=='boolean'||!timestamp(proof.observedAt))throw Error('RESULT_EVIDENCE_MISMATCH');
   return content({availability:'AVAILABLE',sourceSystem:row.sourceSystem,attemptId:row.attemptId,workRef:{workId:row.workId,resolution:'UNRESOLVED'},checkpointId:row.checkpointId,stationId:row.stationId,operation:row.operation,receiptRef:proof.receiptRef,evidenceRef:proof.evidenceRef,domainCompleted:proof.domainCompleted,observedAt:proof.observedAt});
  }catch{return content({code:'SOURCE_READBACK_REJECTED'},true);}
 };
}
