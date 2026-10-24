import {testDeviceAI} from './device-ai.mjs';
import {demoEvents,filterEvents,eventHistory,acceptReadback,escapeHTML as esc} from './workspace-model.mjs';
const $=selector=>document.querySelector(selector);
let mode='demo',liveItems=[],selectedId=demoEvents[0].sourceEventId,aiConfig=null,aiBusy=false,readSequence=0,aiController=null;
const items=()=>mode==='demo'?demoEvents:liveItems;
const format=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}):'ยังไม่มีข้อมูล';
function view(name){
 if(!['overview','events','detail','ai'].includes(name))return;
 document.querySelectorAll('[data-panel]').forEach(panel=>panel.hidden=panel.dataset.panel!==name);
 document.querySelectorAll('.workspace-nav [data-view]').forEach(button=>{if(button.dataset.view===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
 $('#view-title').textContent={overview:'ภาพรวม',events:'เหตุการณ์',detail:'รายละเอียดเหตุการณ์',ai:'Local AI Lab'}[name];
 if(name==='detail')renderDetail();
}
function row(item){return `<button class="event-row" data-event="${esc(item.sourceEventId)}"><span class="event-symbol">${item.category==='REQUEST_SUBMITTED'?'↗':'≡'}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.sourceEventId)} · ${esc(item.ownerSource)}</small></span><span class="event-tag">${esc(item.category)}</span><time>${esc(format(item.occurredAt))}</time><span aria-hidden="true">→</span></button>`;}
function renderList(){
 const results=filterEvents(items(),{query:$('#event-search').value,category:$('#category-filter').value,source:$('#source-filter').value});
 $('#event-count').textContent=results.length+' รายการ'+(mode==='demo'?' · DEMO':' · เฉพาะที่อ่านแล้ว');
 $('#event-results').innerHTML=results.length?results.map(row).join(''):'<div class="empty"><h3>ไม่มีรายการตรงกับตัวกรอง</h3><p>ลองเปลี่ยนคำค้น หรืออ่านคำขอที่ระบุจากระบบเจ้าของ</p></div>';
}
function render(){
 $('#data-banner').textContent=mode==='demo'?'DEMO · ข้อมูลสังเคราะห์สำหรับทดลองหน้าจอ ไม่ใช่กิจกรรมจริง':'LIVE READBACK · เฉพาะคำขอที่อ่านกลับแล้ว ยังไม่มีรายการสดหรือสถิติรวมทั้งระบบ';
 $('#data-banner').classList.toggle('live',mode==='live');
 $('#count-label').textContent=mode==='demo'?'รายการตัวอย่าง':'คำขอที่อ่านกลับในหน้านี้';
 $('#visible-count').textContent=mode==='demo'||liveItems.length?items().length:'—';
 const last=items().map(i=>i.occurredAt).sort().at(-1);$('#latest-time').textContent=last?format(last):'ยังไม่ได้รับข้อมูล';
 $('#recent-events').innerHTML=items().length?items().slice(-3).reverse().map(row).join(''):'<div class="empty"><h3>ยังไม่มีผลอ่านกลับจริง</h3><p>เปิดหน้าเหตุการณ์เพื่อระบุ Request ID · ไม่มีการแทนที่ด้วยข้อมูลตัวอย่าง</p></div>';
 $('#source-filter').innerHTML='<option value="">ทุกแหล่งข้อมูล</option>'+[...new Set(items().map(i=>i.ownerSource))].map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
 renderList();renderDetail();
}
function renderDetail(){
 const item=items().find(i=>i.sourceEventId===selectedId);
 if(!item){$('#event-detail').innerHTML='<div class="detail-card empty"><h2>เลือกรายการเพื่อดูหลักฐาน</h2><p>รายละเอียดและประวัติจะแสดงเฉพาะรายการในชุดข้อมูลที่เลือก</p><button class="text-button" data-view="events">กลับไปหน้าเหตุการณ์ →</button></div>';return;}
 const history=eventHistory(items(),item);
 $('#event-detail').innerHTML=`<button class="text-button" data-view="events">← กลับรายการเหตุการณ์</button><div class="detail-head"><div><p class="eyebrow">${mode==='demo'?'DEMO · SYNTHETIC EVENT':'OWNER HTTP READBACK'}</p><h2>${esc(item.title)}</h2><code>${esc(item.sourceEventId)}</code></div><span class="pill pill--unknown">${esc(item.category)}</span></div><div class="detail-layout"><article class="detail-card"><h3>ที่มาและเวลา</h3><dl><dt>ระบบต้นทาง</dt><dd>${esc(item.ownerSource)}</dd><dt>Request ID</dt><dd>${esc(item.correlationId)}</dd><dt>เวลาเกิดเหตุการณ์</dt><dd>${esc(format(item.occurredAt))}<br><small>${esc(item.occurredAt)}</small></dd><dt>เวลาบันทึกจากต้นทาง</dt><dd>${esc(item.persistedAt)}</dd><dt>ความใหม่</dt><dd>UNKNOWN · เวลาเหตุการณ์ไม่ยืนยันความใหม่ของทั้งระบบ</dd></dl></article><article class="detail-card"><h3>หลักฐานที่อ้างอิง</h3><p class="boundary-note">${mode==='demo'?'ตัวอย่างอ้างอิงเท่านั้น ไม่ใช่หลักฐานจริง':'อ้างอิงจากผลอ่านกลับของ GO ไม่ได้เปิดหรือดาวน์โหลดเอกสารอัตโนมัติ'}</p>${item.evidence.map(ref=>`<code class="evidence-ref">${esc(ref)}</code>`).join('')}<dl><dt>Hub receipt</dt><dd>MISSING · ยังไม่มีใบรับจาก Hub</dd><dt>การลงมือ</dt><dd>NOT_ASSERTED · ไม่ยืนยันผลการทำงาน</dd></dl></article><article class="detail-card"><h3>ประวัติในชุดที่อ่านได้</h3><ol class="timeline">${history.map(h=>`<li><strong>${esc(h.title)}</strong><small>${esc(format(h.occurredAt))} · ${esc(h.sourceEventId)}</small></li>`).join('')}</ol><p class="boundary-note">${mode==='demo'?'ลำดับเหตุการณ์ตัวอย่างสังเคราะห์':'มีเฉพาะ submission ที่ API นี้ส่งกลับ ไม่ใช่ประวัติทั้งหมดของคำขอ'}</p></article></div>`;
}
document.addEventListener('click',event=>{const nav=event.target.closest('[data-view]');if(nav)view(nav.dataset.view);const entry=event.target.closest('[data-event]');if(entry){selectedId=entry.dataset.event;view('detail');}});
$('#data-mode').addEventListener('change',()=>{mode=$('#data-mode').value;selectedId=items()[0]?.sourceEventId;render();});
for(const selector of ['#event-search','#category-filter','#source-filter'])$(selector).addEventListener('input',renderList);
$('#request-read-form').addEventListener('submit',async event=>{
 event.preventDefault();const requestId=$('#request-id').value.trim();if(!/^[A-Za-z0-9:_-]{1,120}$/.test(requestId))return;
 const sequence=++readSequence;$('#read-request').disabled=true;$('#read-message').textContent='กำลังอ่านจากระบบเจ้าของ…';
 try{
  const response=await fetch('/api/greenhouse/requests/'+encodeURIComponent(requestId),{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(10000)});const body=await response.json();
  if(!response.ok)throw Error([401,403].includes(response.status)?'ต้องเชื่อมตัวอ่านที่ยืนยันตัวตนฝั่งเซิร์ฟเวอร์ก่อน · ไม่ต้องกรอก token ในหน้านี้':response.status===404?'ไม่พบคำขอหรือ route ยังไม่พร้อม':'ระบบเจ้าของยังไม่พร้อมอ่านกลับ');
  const item=acceptReadback(body,requestId);if(sequence!==readSequence)return;
  liveItems=[...liveItems.filter(i=>i.correlationId!==requestId),item];mode='live';$('#data-mode').value='live';selectedId=item.sourceEventId;render();$('#read-message').textContent='อ่านกลับแล้ว · ยังไม่มี Hub receipt';view('detail');
 }catch(error){$('#read-message').textContent=error.name==='TimeoutError'?'หมดเวลารอผลอ่านกลับ':error.message==='READBACK_INVALID'?'รูปแบบผลอ่านกลับไม่ตรงตามสัญญา':['ต้องเชื่อมตัวอ่านที่ยืนยันตัวตนฝั่งเซิร์ฟเวอร์ก่อน · ไม่ต้องกรอก token ในหน้านี้','ไม่พบคำขอหรือ route ยังไม่พร้อม','ระบบเจ้าของยังไม่พร้อมอ่านกลับ'].includes(error.message)?error.message:'การเชื่อมต่อไม่พร้อม ลองอีกครั้ง';}
 finally{$('#read-request').disabled=false;}
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
render();aiStatus();
