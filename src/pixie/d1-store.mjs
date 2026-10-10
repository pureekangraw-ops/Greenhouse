// D1 is the durable PIXIE transport log, NOT Hall Work truth.
const PATCH_FIELDS=new Set(['state','reason','queuedAt','dispatchedAt','receiptRef','evidenceRef','domainCompleted','readbackAt']);
const STATES=new Set(['PENDING_QUEUE','WAITING_QUEUE','QUEUED','DISPATCHING','WAITING_ROUTE','OUTCOME_UNKNOWN','ACCEPTED','READBACK_VERIFIED']);
const COLUMN={state:'state',reason:'reason',queuedAt:'queued_at',dispatchedAt:'dispatched_at',
  receiptRef:'receipt_ref',evidenceRef:'evidence_ref',domainCompleted:'domain_completed',readbackAt:'readback_at'};
function mapRow(x){
  if(!x)return null;
  return {attemptId:x.attempt_id,workId:x.work_id,checkpointId:x.checkpoint_id,
    stationId:x.station_id,operation:x.operation,workPassRef:x.work_pass_ref,actor:x.actor,
    state:x.state,receivedAt:x.received_at,queuedAt:x.queued_at,dispatchedAt:x.dispatched_at,
    receiptRef:x.receipt_ref,evidenceRef:x.evidence_ref,reason:x.reason,
    domainCompleted:x.domain_completed===1,readbackAt:x.readback_at};
}
export function createD1PixieStore(db,{clock=()=>new Date().toISOString()}={}){
  if(!db||typeof db.prepare!=='function')throw new TypeError('PIXIE_D1_REQUIRED');
  return Object.freeze({
    async create(r){
      const stmt=db.prepare('INSERT OR IGNORE INTO pixie_attempts (attempt_id,work_id,checkpoint_id,station_id,operation,work_pass_ref,actor,state,received_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(r.attemptId,r.workId,r.checkpointId,r.stationId,r.operation,r.workPassRef,r.actor,r.state,r.receivedAt);
      const result=await stmt.run();
      return Number(result?.meta?.changes||0)===1;
    },
    async get(attemptId){
      const row=await db.prepare('SELECT * FROM pixie_attempts WHERE attempt_id=? LIMIT 1').bind(attemptId).first();
      return mapRow(row);
    },
    async transition(attemptId,from,to,patch={}){
      if(!Array.isArray(from)||!from.length||from.some(s=>!STATES.has(s))||!STATES.has(to)||
        Object.keys(patch).some(key=>!PATCH_FIELDS.has(key)))throw new TypeError('PIXIE_TRANSITION_INVALID');
      const updates={state:to,...patch};
      const cols=Object.keys(updates),sql='UPDATE pixie_attempts SET '+cols.map(key=>COLUMN[key]+'=?').join(', ')+
        ', changed_at=? WHERE attempt_id=? AND state IN ('+from.map(()=>'?').join(',')+')';
      const values=cols.map(key=>key==='domainCompleted'?(updates[key]?1:0):updates[key]);
      const result=await db.prepare(sql).bind(...values,clock(),attemptId,...from).run();
      return Number(result?.meta?.changes||0)===1;
    },
    async listByState(states,limit=20){
      if(!Array.isArray(states)||!states.length||states.some(x=>!STATES.has(x))||
        !Number.isSafeInteger(limit)||limit<1||limit>100)throw new TypeError('PIXIE_QUERY_INVALID');
      const sql='SELECT * FROM pixie_attempts WHERE state IN ('+states.map(()=>'?').join(',')+') ORDER BY received_at LIMIT ?';
      const result=await db.prepare(sql).bind(...states,limit).all();
      return (result.results||[]).map(mapRow);
    },
    async overview(limit=30){
      if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new TypeError('PIXIE_QUERY_INVALID');
      const [grouped,recent]=await Promise.all([
        db.prepare('SELECT state, COUNT(*) AS total FROM pixie_attempts GROUP BY state').all(),
        db.prepare('SELECT * FROM pixie_attempts ORDER BY COALESCE(changed_at,received_at) DESC LIMIT ?').bind(limit).all(),
      ]);
      const states=Object.fromEntries((grouped.results||[]).map(r=>[r.state,Number(r.total)]));
      const count=s=>states[s]||0;
      return {observedAt:clock(),scope:'PIXIE_DELIVERY_ONLY',states,
        counts:{total:Object.values(states).reduce((a,b)=>a+b,0),
          pending:count('PENDING_QUEUE')+count('QUEUED')+count('DISPATCHING'),
          waiting:count('WAITING_QUEUE')+count('WAITING_ROUTE'),
          accepted:count('ACCEPTED'),uncertain:count('OUTCOME_UNKNOWN'),
          readbackVerified:count('READBACK_VERIFIED')},
        items:(recent.results||[]).map(mapRow)};
    },
    async journal(attemptId,limit=100){
      if(typeof attemptId!=='string'||!Number.isSafeInteger(limit)||limit<1||limit>200)
        throw new TypeError('PIXIE_QUERY_INVALID');
      const result=await db.prepare('SELECT attempt_id, old_state, new_state, observed_at, reason, receipt_ref, evidence_ref FROM pixie_journal WHERE attempt_id=? ORDER BY id LIMIT ?')
        .bind(attemptId,limit).all();
      return result.results||[];
    },
  });
}
