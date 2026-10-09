import { getConnectionState, getErrorState } from './ui-state.mjs';

const connection = document.querySelector('#connection');
const statusHeading = document.querySelector('#status-heading');
const statusPill = document.querySelector('#status-pill');
const statusDetail = document.querySelector('#status-detail');
const inbox = document.querySelector('#inbox');
const workList = document.querySelector('#work-list');
const refreshButton = document.querySelector('#refresh');

function text(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function setConnection(key, detail = null) {
  const state = getConnectionState(key);
  connection.innerHTML = '<i></i> ' + text(state.connection);
  statusHeading.textContent = state.heading;
  statusPill.textContent = state.pill;
  statusPill.className = 'pill ' + state.className;
  statusDetail.textContent = detail || state.detail;
}
function showMessage(key, observedAt = null) {
  const state = getConnectionState(key);
  const detail = observedAt && key === 'connectedEmpty'
    ? state.inboxDetail + ' ' + text(observedAt) + '.'
    : state.inboxDetail;
  const markup = '<div class="empty"><span class="empty-icon">' + text(state.icon) + '</span><h3>' + text(state.inboxTitle) + '</h3><p>' + text(detail) + '</p></div>';
  inbox.innerHTML = markup;
  workList.innerHTML = markup;
}
function showFailure(code) {
  const key = getErrorState(code);
  setConnection(key);
  showMessage(key);
}
function renderWorkItem(item) {
  const ownerSource = text(item.ownerSource || 'UNKNOWN');
  const observedAt = text(item.observedAt || 'UNKNOWN');
  const freshness = text(item.freshness || 'UNKNOWN');
  const confidence = text(item.confidence || 'UNKNOWN');
  const workId = text(item.workId || 'ไม่มี Work ID ในผลอ่านกลับ');
  const checkpointId = text(item.checkpointId || 'UNKNOWN');
  const ownerState = text(item.ownerState || 'UNKNOWN');
  const workStatus = text(item.workStatus || 'UNKNOWN');
  const title = text(item.title || 'ผลอ่านกลับจากระบบเจ้าของ');
  const nextAction = item.nextAction
    ? text(item.nextAction)
    : 'UNKNOWN — ยังไม่มี Next Action ใน readback contract';
  const evidence = Array.isArray(item.evidence) && item.evidence.length
    ? `<ul>${item.evidence.map(ref => `<li>${text(ref)}</li>`).join('')}</ul>`
    : '<p>ยังไม่มี evidence reference ใน readback</p>';
  const limitations = Array.isArray(item.limitations) && item.limitations.length
    ? `<ul>${item.limitations.map(note => `<li>${text(note)}</li>`).join('')}</ul>`
    : '<p>UNKNOWN — ไม่มีข้อจำกัดแนบมาใน readback</p>';
  return `<article class="readback"><h3>${title}</h3><p>แหล่งข้อมูล: ${ownerSource} · ความเชื่อมั่น: ${confidence}</p><p>เวลาที่ตรวจ: ${observedAt} · ความใหม่: ${freshness}</p><p>สถานะ Work: ${ownerState} · สถานะประสานงาน: ${workStatus}</p><code>Work: ${workId} · Checkpoint: ${checkpointId}</code><p class="readback-next"><strong>Next Action จาก readback:</strong> ${nextAction}</p><div class="readback-detail"><strong>Evidence references</strong>${evidence}</div><div class="readback-detail"><strong>ข้อจำกัด</strong>${limitations}</div></article>`;
}
async function loadInbox() {
  refreshButton.disabled = true;
  setConnection('loading');
  showMessage('loading');
  try {
    const statusRes = await fetch('/api/greenhouse/status', {cache:'no-store', credentials:'same-origin'});
    const status = await statusRes.json();
    if (!statusRes.ok) { showFailure(status.code); return; }
    if (!status.ownerSession) { showFailure('OWNER_SESSION_REQUIRED'); return; }
    if (!status.inboxReader) { showFailure('HUB_READER_UNAVAILABLE'); return; }
    const response = await fetch('/api/greenhouse/inbox', {cache:'no-store', credentials:'same-origin'});
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.items)) { showFailure(payload.code || 'HUB_READBACK_FAILED'); return; }
    if (!payload.items.length) {
      setConnection('connectedEmpty', 'อ่านจาก Hub แบบ read-only แล้ว · เวลาที่ตรวจ ' + (payload.observedAt || 'UNKNOWN'));
      showMessage('connectedEmpty', payload.observedAt || 'UNKNOWN');
      return;
    }
    setConnection('connected');
    const readbacks = payload.items.map(renderWorkItem).join('');
    inbox.innerHTML = readbacks;
    workList.innerHTML = readbacks;
  } catch {
    showFailure('HUB_READBACK_FAILED');
  } finally {
    refreshButton.disabled = false;
  }
}
function selectView(view) {
  for (const panel of document.querySelectorAll('[data-view-panel]')) {
    panel.hidden = panel.dataset.viewPanel !== view;
  }
  for (const button of document.querySelectorAll('[data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
document.querySelector('.workspace-nav').addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (button) selectView(button.dataset.view);
});
document.querySelector('#refresh').addEventListener('click', loadInbox);
document.querySelector('#reload').addEventListener('click', loadInbox);
loadInbox();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/greenhouse/sw.js', {scope:'/greenhouse/'}).catch(() => {});

// Installation is an explicit user gesture; no automatic install prompt.
const installButton = document.querySelector('#install');
const installHelp = document.querySelector('#install-help');
let pendingInstall = null;
function showInstallHelp(message) {
  installHelp.textContent = message;
  installHelp.hidden = false;
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  pendingInstall = event;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (!pendingInstall) {
    showInstallHelp('เปิดเมนูเบราว์เซอร์ แล้วเลือก ติดตั้งแอป หรือ เพิ่มไปยังหน้าจอหลัก');
    return;
  }
  const prompt = pendingInstall;
  pendingInstall = null;
  installButton.hidden = true;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice?.outcome !== 'accepted') showInstallHelp('ยังไม่ได้ติดตั้ง คุณสามารถติดตั้งจากเมนูเบราว์เซอร์ได้');
});
window.addEventListener('appinstalled', () => {
  pendingInstall = null;
  installButton.hidden = true;
  showInstallHelp('ติดตั้ง Greenhouse บนเครื่องแล้ว');
});
if (window.matchMedia('(display-mode: standalone)').matches) {
  installButton.hidden = true;
} else {
  showInstallHelp('บน Android เปิดผ่าน Chrome แล้วเลือกเมนู ⋮ → ติดตั้งแอป เมื่อเว็บพร้อมติดตั้ง');
}
