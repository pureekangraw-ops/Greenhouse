import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getConnectionState, getErrorState } from '../greenhouse/ui-state.mjs';

test('Owner Inbox is Thai-first and exposes distinct safe connection states', async () => {
  const html = await readFile(new URL('../greenhouse/index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="th">/);
  assert.match(html, /type="module" src="\/greenhouse\/app\.js"/);
  assert.match(html, /ตรวจการเชื่อมต่อ/);
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

test('connected empty inbox explicitly shows observed time and is not labeled disconnected', () => {
  const state = getConnectionState('connectedEmpty');
  assert.equal(state.pill, 'CONNECTED');
  assert.match(state.inboxDetail, /Hub ส่งรายการว่าง/);
  assert.equal(getConnectionState('unknown-key').pill, 'ERROR');
});
