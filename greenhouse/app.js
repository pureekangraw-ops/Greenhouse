import { getConnectionState, getErrorState } from './ui-state.mjs';

const connection = document.querySelector('#connection');
const statusHeading = document.querySelector('#status-heading');
const statusPill = document.querySelector('#status-pill');
const statusDetail = document.querySelector('#status-detail');
const inbox = document.querySelector('#inbox');
const operations = document.querySelector('#operations');
async function loadOperations() {
  try {
    const response = await fetch('/api/greenhouse/operations', {cache:'no-store',credentials:'same-origin'});
    const report = await response.json();
    if (!response.ok || !report?.counts || !Array.isArray(report.items)) {
      operations.innerHTML = '<div class="empty"><h3>Operational Log ยังไม่พร้อม</h3><p>' +
        text(report.code || 'UNKNOWN') + ' — ไม่แสดงข้อมูลจำลอง</p></div>';
      return;
    }
    const c = report.counts;
    const summary = 'Attempts: ' + text(c.attempts) + ' · Running: ' + text(c.running) +
      ' · Waiting: ' + text(c.waiting) + ' · Incidents: ' + text(c.incidents) +
      ' · Hall closed: ' + text(c.hallClosed);
    const rows = report.items.slice(0, 30).map(item =>
      '<article class="readback"><h3>' + text(item.workId) + '</h3><p>ปลายทาง: ' +
      text(item.stationId) + ' · ' + text(item.operation) + '</p><p>PIXIE: ' +
      text(item.delivery) + ' · TOOL: ' + text(item.execution) + ' · HALL: ' +
      text(item.hall) + '</p><p>รอ: ' + text(item.waitingOn || '-') +
      ' · สาเหตุ: ' + text(item.blocker || '-') + '</p><p>เหตุการณ์ล่าสุด: ' +
      text(item.lastSeenAt) + ' · ' + text(item.confidence) +
      '</p></article>').join('');
    operations.innerHTML = '<p><strong>' + summary + '</strong></p>' +
      (rows || '<div class="empty"><p>ไม่มีเหตุการณ์ที่ตรวจยืนยันได้</p></div>');
  } catch {
    operations.innerHTML = '<div class="empty"><h3>Operational Log ยังไม่พร้อม</h3><p>READBACK_UNAVAILABLE</p></div>';
  }
}

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
    ? state.inboxDetail + ' ' + observedAt + '.'
    : state.inboxDetail;
  inbox.innerHTML = '<div class="empty"><span class="empty-icon">' + text(state.icon) + '</span><h3>' + text(state.inboxTitle) + '</h3><p>' + text(detail) + '</p></div>';
}
function showFailure(code) {
  const key = getErrorState(code);
  setConnection(key);
  showMessage(key);
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
    await loadOperations();
    if (!status.inboxReader) { showFailure('HUB_READER_UNAVAILABLE'); return; }
    const response = await fetch('/api/greenhouse/inbox', {cache:'no-store', credentials:'same-origin'});
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.items)) { showFailure(payload.code || 'HUB_READBACK_FAILED'); return; }
    if (!payload.items.length) {
      setConnection('connectedEmpty', 'อ่านจาก Hub แบบ read-only แล้ว · เวลาที่ตรวจ ' + text(payload.observedAt || 'UNKNOWN'));
      showMessage('connectedEmpty', text(payload.observedAt || 'UNKNOWN'));
      return;
    }
    setConnection('connected');
    inbox.innerHTML = payload.items.map(item => `<article class="readback"><h3>${text(item.title || 'ผลอ่านกลับจากระบบเจ้าของ')}</h3><p>แหล่งข้อมูล: ${text(item.ownerSource || 'UNKNOWN')} · ความเชื่อมั่น: ${text(item.confidence || 'UNKNOWN')}</p><p>เวลาที่ตรวจ: ${text(item.observedAt || 'UNKNOWN')} · ความใหม่: ${text(item.freshness || 'UNKNOWN')}</p><code>${text(item.workId || 'ไม่มี Work ID ในผลอ่านกลับ')}</code></article>`).join('');
  } catch {
    showFailure('HUB_READBACK_FAILED');
  } finally {
    refreshButton.disabled = false;
  }
}
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
