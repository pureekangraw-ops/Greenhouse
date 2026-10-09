import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getConnectionState, getErrorState } from '../greenhouse/ui-state.mjs';

test('Owner Workspace is Thai-first and exposes distinct safe connection states', async () => {
  const html = await readFile(new URL('../greenhouse/index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="th">/);
  assert.match(html, /type="module" src="\/greenhouse\/app\.js"/);
  assert.match(html, /ตรวจการเชื่อมต่อ/);
  assert.match(html, /All-in-One AI Workplace/);
  for (const oldEnglish of ['Not connected', 'Check connection', 'Owner readbacks', 'Actions stay with the owner']) {
    assert.equal(html.includes(oldEnglish), false);
  }
  assert.notEqual(getConnectionState('disconnected').heading, getConnectionState('connectedEmpty').heading);
  assert.notEqual(getConnectionState('connectedEmpty').heading, getConnectionState('loadError').heading);
  assert.notEqual(getConnectionState('authRequired').heading, getConnectionState('disconnected').heading);
  assert.equal(getErrorState('OWNER_SESSION_REQUIRED'), 'authRequired');
  assert.equal(getErrorState('HUB_READER_UNAVAILABLE'), 'disconnected');
  assert.equal(getErrorState('HUB_READBACK_FAILED'), 'loadError');
});

test('workspace sections are projections, do not invent Work or Parcel records, and preserve review boundary', async () => {
  const html = await readFile(new URL('../greenhouse/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../greenhouse/app.js', import.meta.url), 'utf8');
  const views = [...html.matchAll(/data-view="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(views, ['home', 'work', 'tools', 'express', 'artifacts', 'observatory', 'review']);
  assert.doesNotMatch(html, /ประชุม|Meetings/);
  assert.match(html, /METROPOLIS[\s\S]*Greenhouse[\s\S]*Authorized Agent \/ Tool[\s\S]*Owner System readback[\s\S]*Existing return path/);
  assert.match(html, /Work System เป็นเจ้าของ Work Lifecycle/);
  assert.match(html, /PIXIE เก็บ technical lineage ไม่ใช่ผู้คุม Lifecycle/);
  assert.match(html, /บทบาทและ contract ของ PIXIE EXPRESS ยังไม่ยืนยัน/);
  assert.match(html, /ไม่มีสถานะ Parcel จำลอง/);
  assert.match(html, /GO และ LIGHT ตรวจทั้งคู่/);
  assert.match(html, /ผู้มีอำนาจดำเนินการเอง/);
  assert.match(html, /ไม่มี review queue หรือ command adapter เปิดใช้งาน/);
  assert.match(app, /UNKNOWN — ยังไม่มี Next Action ใน readback contract/);
  assert.match(app, /Next Action จาก readback/);
  assert.match(app, /item\.evidence\.map\(ref => `\<li>\$\{text\(ref\)\}<\/li>`\)/);
  assert.match(app, /item\.limitations\.map\(note => `\<li>\$\{text\(note\)\}<\/li>`\)/);
  assert.match(app, /workList\.innerHTML = readbacks/);
});

test('connected empty inbox explicitly shows observed time and is not labeled disconnected', () => {
  const state = getConnectionState('connectedEmpty');
  assert.equal(state.pill, 'CONNECTED');
  assert.match(state.inboxDetail, /Hub ส่งรายการว่าง/);
  assert.equal(getConnectionState('unknown-key').pill, 'ERROR');
});

test('PWA install is user-initiated and does not turn a missing Hub into a connected state', async () => {
  const html = await readFile(new URL('../greenhouse/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../greenhouse/app.js', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../greenhouse/sw.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('../greenhouse/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.match(html, /id="install"[^>]*hidden/);
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /installButton\.addEventListener\('click'/);
  assert.match(app, /await prompt\.prompt\(\)/);
  assert.match(app, /if \(!status\.ownerSession\)/);
  assert.match(app, /if \(!status\.inboxReader\)/);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/greenhouse/');
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.doesNotMatch(sw, /caches\.open\([^)]*\)\.then\([^)]*cache\.addAll\([^)]*\/api\//);
});
