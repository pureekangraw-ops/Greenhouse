import {testDeviceAI} from './device-ai.mjs';
import {demoEvents,acceptReadback,escapeHTML as esc,trackingKey,trackingStatus,filterTracking,acceptTracking,requestTracking,renderTrackingRow,itemsAfterReadFailure,trackingTime as format} from './workspace-model.mjs';
const $=selector=>document.querySelector(selector);
// The retained request endpoint has no namespace argument. Remember its last
// successful exact identity rather than clearing other sources with the same ID.
const requestReadRefs=new Map();
let mode='live',liveItems=[],selectedId=null,aiConfig=null,aiBusy=false,readSequence=0,aiController=null,listSequence=0,detailSequence=0,listScroll=0,lastRow=null;
const demoItems=demoEvents.map(e=>({...requestTracking(e),ref:{sourceSystem:e.ownerSource,resourceType:'EVENT',resourceId:e.sourceEventId}}));
const items=()=>mode==='demo'?demoItems:liveItems;
function view(name){
 if(!['events','detail','settings','ai'].includes(name))return;
 document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==name);
 document.querySelectorAll('.workspace-nav [data-view]').forEach(b=>{if(b.dataset.view===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
 $('#view-title').textContent={events:'งานของฉัน',detail:'รายละเอียด',settings:'การตั้งค่า',ai:'Local AI Lab'}[name];
 if(name==='detail')renderDetail();
 if(name==='events'){renderList();requestAnimationFrame(()=>{window.scrollTo(0,listScroll);lastRow=[...document.querySelectorAll('[data-tracking]')].find(row=>row.dataset.tracking===selectedId);lastRow?.focus({preventScroll:true});});}else $('#view-title').focus({preventScroll:true});
}
function renderList(){
 const rows=filterTracking(items(),{query:$('#event-search').value,status:$('#category-filter').value,source:$('#source-filter').value});
 $('#event-count').textContent=rows.length+' รายการที่ตรงตัวกรอง · '+items().length+' รายการในชุดที่อ่านได้ · ไม่ทราบจำนวนทั้งหมด';
 $('#event-results').innerHTML=rows.length?rows.map(renderTrackingRow).join(''):'<div class="empty"><h3>ไม่มีรายการที่แสดงได้</h3><p>ตรวจสถานะการเชื่อมต่อหรือเปลี่ยนตัวกรอง · ไม่มีการเติมข้อมูลตัวอย่างอัตโนมัติ</p></div>';
}
function render(){
 $('#data-banner').textContent=mode==='demo'?'DEMO · ข้อมูลสังเคราะห์สำหรับทดลองหน้าจอ ไม่ใช่งานหรือผลลัพธ์จริง':'LIVE · รายการจากแหล่งที่เชื่อมต่อ · ช่วงล่าสุดที่อ่านได้ ไม่ครบทุกงาน';
 $('#data-banner').classList.toggle('live',mode==='live');
 const source=$('#source-filter').value;
 $('#source-filter').innerHTML='<option value="">ทุกแหล่งข้อมูล</option>'+[...new Set(items().map(i=>i.ref.sourceSystem))].map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
 $('#source-filter').value=source;renderList();renderDetail();
}
function renderDetail(){
 const item=items().find(i=>trackingKey(i.ref)===selectedId);
 if(!item){$('#event-detail').innerHTML='<button class="text-button" data-view="events">← กลับรายการ</button><p>ยังไม่มีรายละเอียดที่อ่านยืนยันได้</p>';return;}
 const status=trackingStatus(item);
 $('#event-detail').innerHTML=`<button class="text-button" data-view="events">← กลับรายการ</button><p id="detail-state" role="status" aria-live="polite"></p><article class="detail-card"><p class="eyebrow">${mode==='demo'?'DEMO · SYNTHETIC':esc(item.ref.resourceType)}</p><h2>${esc(item.title)}</h2><h3>สิ่งที่ควรทำต่อ</h3><p>${esc(item.nextAction||'ต้นทางยังไม่ระบุสิ่งที่ต้องทำต่อ')}</p><p><strong>${esc(status.label)}</strong></p><button id="item-refresh" class="button" type="button" ${mode==='demo'?'disabled':''}>อ่านสถานะรายการนี้ใหม่</button></article><div class="detail-layout"><article class="detail-card"><h3>สถานะตามต้นทาง</h3><p class="boundary-note">แสดงข้อเท็จจริงแต่ละมิติ · ใบรับไม่ยืนยัน Work เสร็จ · ไม่มีเปอร์เซ็นต์สังเคราะห์</p><dl>${item.statusFacts.map(f=>`<dt>${esc(f.dimension)}</dt><dd>${esc(f.value)}<br>ต้นทางอัปเดต: ${esc(format(f.sourceUpdatedAt))}<br>ตรวจอ่าน: ${esc(format(f.observedAt))}</dd>`).join('')||'<dd>ยังไม่มีข้อเท็จจริงสถานะ</dd>'}</dl></article><article class="detail-card"><h3>ผลและหลักฐาน</h3><p>สถานะผล: ${esc(item.result.availability)}</p><p class="boundary-note">แสดงเฉพาะอ้างอิงที่ต้นทางส่งกลับ · ไม่เปิด URL หรือดาวน์โหลดหลักฐานอัตโนมัติ</p><details><summary>อ้างอิงและที่มาทางเทคนิค</summary><dl><dt>ระบบ / ประเภท / รหัส</dt><dd>${esc(item.ref.sourceSystem)} / ${esc(item.ref.resourceType)} / ${esc(item.ref.resourceId)}</dd><dt>แหล่งข้อมูล</dt><dd>${esc(item.provenance.sourceSystem)} · ${esc(item.provenance.sourceRef)}</dd><dt>ความพร้อมของแหล่ง</dt><dd>${esc(item.provenance.availability)} · ตรวจอ่าน ${esc(format(item.provenance.observedAt))}</dd><dt>ใบรับ</dt><dd>${esc(item.result.receiptRef||'ยังไม่มีใบรับที่ยืนยัน')}</dd><dt>หลักฐานผล</dt><dd>${esc(item.result.evidenceRef||'ยังไม่มีหลักฐานผลที่ยืนยัน')}</dd></dl>${item.requestEvent?item.requestEvent.evidence.map(r=>`<code class="evidence-ref">${esc(r)}</code>`).join(''):''}${(item.links||[]).map(l=>`<code class="evidence-ref">${esc(typeof l==='string'?l:JSON.stringify(l))}</code>`).join('')}</details></article></div>`;
}
const failure=response=>[401,403].includes(response.status)?'ไม่มีสิทธิ์อ่านหรือเซสชันยังไม่พร้อม':response.status===404?'ไม่พบรายการที่มีสิทธิ์อ่าน':'แหล่งข้อมูลยังไม่เชื่อมต่อหรือไม่พร้อมอ่าน';
async function loadTracking(){
 if(mode!=='live')return;const sequence=++listSequence;$('#tracking-refresh').disabled=true;$('#tracking-state').textContent='กำลังอ่านข้อมูลจริง…';
 try{const response=await fetch('/api/greenhouse/tracking?limit=30',{method:'GET',cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});const body=await response.json();if(!response.ok)throw Error(failure(response));acceptTracking(body);if(sequence!==listSequence||mode!=='live')return;
 liveItems=body.items;$('#tracking-state').textContent=(body.items.length?'อ่านช่วงรายการล่าสุดแล้ว':'เชื่อมต่อแล้ว · ต้นทางส่งรายการว่าง')+' · ตรวจอ่าน '+format(body.observedAt)+' · ไม่ครอบคลุมทุกงาน';render();
 }catch(error){if(sequence!==listSequence||mode!=='live')return;liveItems=[];$('#tracking-state').textContent=(error.message==='TRACKING_INVALID'?'รูปแบบข้อมูลไม่ตรงสัญญา':error.name==='TimeoutError'?'หมดเวลารอแหล่งข้อมูล':error.message.startsWith('แหล่ง')||error.message.startsWith('ไม่มีสิทธิ์')?error.message:'อ่านข้อมูลไม่สำเร็จ')+' · ยังไม่ยืนยันรายการจริง';render();}
 finally{if(sequence===listSequence)$('#tracking-refresh').disabled=false;}
}
async function refreshItem(){
 const item=items().find(i=>trackingKey(i.ref)===selectedId);if(!item||mode!=='live')return;const key=selectedId,sequence=++detailSequence;$('#item-refresh').disabled=true;$('#detail-state').textContent='กำลังอ่านรายการที่เลือก…';
 try{let fresh;if(item.requestEvent){const r=await fetch('/api/greenhouse/requests/'+encodeURIComponent(item.ref.resourceId),{method:'GET',cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Object.assign(Error(failure(r)),{status:r.status});fresh=requestTracking(acceptReadback(await r.json(),item.ref.resourceId));if(trackingKey(fresh.ref)!==key)throw Error('TRACKING_INVALID');}else{const r=await fetch('/api/greenhouse/tracking/item?'+new URLSearchParams(item.ref),{method:'GET',cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Object.assign(Error(failure(r)),{status:r.status});fresh=acceptTracking(await r.json(),item.ref).items[0];}
 if(sequence!==detailSequence||selectedId!==key||mode!=='live')return;liveItems=liveItems.map(i=>trackingKey(i.ref)===key?fresh:i);renderDetail();$('#detail-state').textContent='อัปเดตข้อมูลรายการนี้แล้ว';
 }catch(error){if(sequence!==detailSequence||selectedId!==key||mode!=='live')return;liveItems=itemsAfterReadFailure(liveItems,item.ref,error.status);if([401,403,404].includes(error.status)){selectedId=null;render();$('#event-detail').innerHTML='<button class="text-button" data-view="events">← กลับรายการ</button><p role="status">ไม่พบรายการที่มีสิทธิ์อ่าน · ล้างรายละเอียดที่อ่านไว้ก่อนหน้าแล้ว</p>';}else $('#detail-state').textContent='อ่านรายการนี้ไม่สำเร็จ · รายละเอียดด้านล่างเป็นผลอ่านก่อนหน้า อาจเก่า โปรดตรวจเวลาอ่านเดิม';}
 finally{if($('#item-refresh'))$('#item-refresh').disabled=false;}
}
document.addEventListener('click',event=>{const nav=event.target.closest('[data-view]');if(nav)view(nav.dataset.view);const entry=event.target.closest('[data-tracking]');if(entry){listScroll=window.scrollY;lastRow=entry;selectedId=entry.dataset.tracking;view('detail');if(mode==='live'&&!items().find(i=>trackingKey(i.ref)===selectedId)?.requestEvent)refreshItem();}if(event.target.closest('#item-refresh'))refreshItem();});
$('#data-mode').addEventListener('change',()=>{mode=$('#data-mode').value;++readSequence;++listSequence;++detailSequence;selectedId=null;$('#read-request').disabled=false;$('#tracking-refresh').disabled=false;$('#tracking-state').textContent=mode==='demo'?'กำลังดูข้อมูลสังเคราะห์เท่านั้น':'กำลังอ่านข้อมูลจริง…';render();view('events');if(mode==='live')loadTracking();});
for(const selector of ['#event-search','#category-filter','#source-filter'])$(selector).addEventListener('input',renderList);
$('#tracking-refresh').addEventListener('click',loadTracking);
$('#request-read-form').addEventListener('submit',async event=>{
 event.preventDefault();const requestId=$('#request-id').value.trim();if(!/^[A-Za-z0-9:_-]{1,120}$/.test(requestId))return;const sequence=++readSequence;$('#read-request').disabled=true;$('#read-message').textContent='กำลังอ่านจากระบบเจ้าของ…';
 try{const response=await fetch('/api/greenhouse/requests/'+encodeURIComponent(requestId),{method:'GET',cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Object.assign(Error(failure(response)),{status:response.status});const item=requestTracking(acceptReadback(await response.json(),requestId));if(sequence!==readSequence)return;++listSequence;mode='live';$('#data-mode').value='live';selectedId=trackingKey(item.ref);requestReadRefs.set(requestId,item.ref);liveItems=[...liveItems.filter(i=>trackingKey(i.ref)!==selectedId),item];$('#tracking-state').textContent='มีคำขอที่อ่านโดยระบุรหัสในหน้านี้ · ไม่ใช่รายการ Work ทั้งหมด';render();$('#read-message').textContent='อ่านคำขอแล้ว · ยังไม่ยืนยัน Work หรือผลการลงมือ';view('detail');}
 catch(error){
  if(sequence!==readSequence)return;
  const previousRef=requestReadRefs.get(requestId);
  if(previousRef&&[401,403,404].includes(error.status)){
   liveItems=itemsAfterReadFailure(liveItems,previousRef,error.status);requestReadRefs.delete(requestId);
   if(selectedId===trackingKey(previousRef)){++detailSequence;selectedId=null;}
   render();$('#read-message').textContent='ไม่พบคำขอที่มีสิทธิ์อ่าน · ล้างรายละเอียดและหลักฐานที่อ่านไว้แล้ว';
  }else $('#read-message').textContent=previousRef?'อ่านคำขอไม่สำเร็จ · ผลอ่านก่อนหน้าอาจเก่า โปรดตรวจเวลาอ่านเดิม':'อ่านคำขอไม่สำเร็จ · ยังไม่ยืนยันผลอ่านกลับ';
 }finally{if(sequence===readSequence)$('#read-request').disabled=false;}
});
function updateRun(){
 const device=$('#ai-route').value==='device';
 const ready=device?$('#device-protocol').value==='chat-completions-compatible'&&$('#device-confirm').checked&&$('#device-model').value.trim():aiConfig?.configured&&aiConfig?.csrfToken&&$('#ai-model').value;
 $('#ai-run').disabled=aiBusy||!ready||!$('#ai-synthetic').checked||!$('#ai-input').value.trim();
}
function deviceMode(){
 const device=$('#ai-route').value==='device';$('#device-config').hidden=!device;$('#ai-refresh').hidden=device;$('#ai-model').closest('label').hidden=device;
 if(device){$('#ai-state').textContent='DEVICE · PROTOCOL UNVERIFIED';$('#ai-connection').textContent='สถานะการเชื่อมต่อจากเบราว์เซอร์: ยังไม่ทดสอบ · สถานะ RUNNING มาจากหน้าจอเจ้าของ ไม่ใช่ health check';}
 else aiStatus();
 updateRun();
}
$('#ai-route').addEventListener('change',deviceMode);
for(const selector of ['#device-protocol','#device-model','#device-confirm'])$(selector).addEventListener('input',updateRun);
$('#ai-cancel').addEventListener('click',()=>aiController?.abort());
async function aiStatus(){
 $('#ai-refresh').disabled=true;aiConfig=null;updateRun();
 try{
  const response=await fetch('/api/greenhouse/local-ai',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(5000)});const body=await response.json();
  if(!response.ok||body.configured!==true||!Array.isArray(body.models)||!body.models.length)throw Error('DISCONNECTED');
  aiConfig=body;$('#ai-model').innerHTML=body.models.map(model=>`<option value="${esc(model)}">${esc(model)}</option>`).join('');$('#ai-model').disabled=false;
  $('#ai-state').textContent='CONFIGURED · NOT TESTED';$('#overview-ai').textContent='ตั้งค่าแล้ว · ยังไม่ทดสอบ';$('#ai-connection').textContent='มี provider ที่อนุญาตแล้ว · สถานะนี้ยังไม่ยืนยันว่าโมเดลตอบได้';
 }catch{
  $('#ai-state').textContent='DISCONNECTED';$('#overview-ai').textContent='ยังไม่เชื่อมต่อ';$('#ai-model').innerHTML='<option value="">ยังไม่มีโมเดลที่ตั้งค่า</option>';$('#ai-model').disabled=true;$('#ai-connection').textContent='รอชื่อและปลายทาง runtime ที่ได้รับอนุญาต · ไม่มีการตรวจ localhost หรือปลายทางส่วนตัว';
 }finally{$('#ai-refresh').disabled=false;updateRun();}
}
$('#ai-refresh').addEventListener('click',aiStatus);for(const selector of ['#ai-model','#ai-input','#ai-synthetic'])$(selector).addEventListener('input',updateRun);
$('#ai-clear').addEventListener('click',()=>{if(aiBusy)return;$('#ai-input').value='';$('#ai-synthetic').checked=false;$('#ai-output').textContent='ล้างข้อความและผลลัพธ์แล้ว';$('#ai-result-status').textContent='ยังไม่ได้ทดสอบ';$('#ai-time').textContent='— ms';updateRun();});
$('#ai-form').addEventListener('submit',async event=>{
 event.preventDefault();if($('#ai-run').disabled)return;aiBusy=true;aiController=new AbortController();updateRun();$('#ai-clear').disabled=true;$('#ai-refresh').disabled=true;$('#ai-route').disabled=true;$('#ai-cancel').hidden=false;$('#ai-result-status').textContent='กำลังทดสอบ inference…';$('#ai-output').textContent='ยังไม่มีคำตอบ · การเริ่มทดสอบไม่ใช่การยืนยันว่าเชื่อมต่อแล้ว';const started=performance.now();
 let timeout,providerTimedOut=false;
 try{
  let body;
  if($('#ai-route').value==='device'){
   body=await testDeviceAI({model:$('#device-model').value,text:$('#ai-input').value,protocol:$('#device-protocol').value,protocolConfirmed:$('#device-confirm').checked,syntheticOnly:$('#ai-synthetic').checked,signal:aiController.signal});
   $('#ai-connection').textContent='ได้รับ HTTP response และคำตอบตามรูปแบบที่เลือกจาก loopback บนอุปกรณ์นี้ · ไม่ใช่หลักฐานการลงมือ';
  }else{
   timeout=setTimeout(()=>{providerTimedOut=true;aiController.abort();},12000);
   const response=await fetch('/api/greenhouse/local-ai',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','x-csrf-token':aiConfig.csrfToken},body:JSON.stringify({model:$('#ai-model').value,text:$('#ai-input').value,syntheticOnly:true}),signal:aiController.signal});
   body=await response.json();if(!response.ok)throw Error('TEST_UNAVAILABLE');
  }
  if(typeof body.reply!=='string'||typeof body.modelStatus!=='string'||body.executed!==false)throw Error('TEST_INVALID');
  $('#ai-output').textContent=body.reply;$('#ai-result-status').textContent=body.modelStatus==='RESPONDED'?'โมเดลตอบแล้ว · ไม่ใช่ผลการลงมือ':body.modelStatus+' · คำตอบสำรองจาก policy ไม่ใช่คำตอบโมเดล';$('#ai-state').textContent=body.modelStatus;$('#overview-ai').textContent=body.modelStatus==='RESPONDED'?'ตอบในการทดสอบแล้ว':'ใช้คำตอบสำรอง';
 }catch(error){
  const code=error.code|| (providerTimedOut?'TIMEOUT':aiController.signal.aborted?'CANCELLED':'TEST_ERROR');
  $('#ai-result-status').textContent=code+' · ยังไม่ยืนยันผล inference';
  $('#ai-output').textContent=code==='DEVICE_BLOCKED_OR_UNREACHABLE'?'เบราว์เซอร์อาจบล็อก loopback หรือ server อาจเข้าถึงไม่ได้ ไม่สรุปว่า HERMES หยุดทำงาน และไม่เปลี่ยน auth/CORS/เครือข่าย':code==='CANCELLED'?'ยกเลิกแล้ว · ไม่ได้ยืนยันผลทดสอบ':'ตรวจ protocol และการอนุญาตบนอุปกรณ์ตามปกติ · ยังใช้หน้าเหตุการณ์ต่อได้';
  if($('#ai-route').value==='device')$('#ai-connection').textContent=error.reachable?'ได้รับ HTTP response แล้ว แต่ยังไม่ยืนยันรูปแบบหรือผล inference':'ยังไม่ยืนยันการเชื่อมต่อจากเบราว์เซอร์';
  $('#ai-state').textContent=code;$('#overview-ai').textContent='ทดสอบยังไม่พร้อม';
 }finally{clearTimeout(timeout);$('#ai-time').textContent=Math.round(performance.now()-started)+' ms';aiBusy=false;aiController=null;$('#ai-clear').disabled=false;$('#ai-refresh').disabled=false;$('#ai-route').disabled=false;$('#ai-cancel').hidden=true;updateRun();}
});
render();loadTracking();aiStatus();
