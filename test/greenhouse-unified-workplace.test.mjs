import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Greenhouse mounts the personal planner as a distinct local-only surface', async () => {
  const [shell, server, planner, plannerJs] = await Promise.all([
    read('../greenhouse/index.html'),
    read('../server.mjs'),
    read('../greenhouse/personal/index.html'),
    read('../greenhouse/personal/app.js'),
  ]);
  assert.match(shell, /href="\/greenhouse\/personal\/"[^>]*>พื้นที่ส่วนตัว/);
  assert.match(server, /\/greenhouse\/personal\//);
  assert.match(server, /greenhouse\/personal\/app\.js/);
  assert.match(server, /greenhouse\/personal\/app\.css/);
  assert.match(planner, /พื้นที่ร่างส่วนตัว · LOCAL ONLY/);
  assert.match(planner, /href="\/greenhouse\/"/);
  assert.match(planner, /href="\/greenhouse\/personal\/app\.css"/);
  assert.match(planner, /src="\/greenhouse\/personal\/app\.js" defer/);
  assert.doesNotMatch(planner, /<script>\s*[\s\S]*?<\/script>/i);
  assert.match(plannerJs, /localStorage/);
  assert.match(plannerJs, /normalizeLocalAIEndpoint/);
  assert.match(plannerJs, /\['localhost','127\.0\.0\.1'\]/);
  assert.match(plannerJs, /\/models/);
  assert.match(plannerJs, /\/chat\/completions/);
  assert.match(plannerJs, /ไม่แนบรายการงาน\/โปรเจกต์โดยอัตโนมัติ/);
  assert.doesNotMatch(plannerJs, /\/api\//);
});

test('inline style allowance is scoped to the planner route; scripts remain same-origin only', async () => {
  const server = await read('../server.mjs');
  const route = server.indexOf("['/greenhouse/personal/'");
  const nextRoute = server.indexOf("['/greenhouse/personal/index.html'");
  assert.notEqual(route, -1);
  assert.notEqual(nextRoute, -1);
  const plannerRouteLine = server.slice(route, server.indexOf('\n', route));
  const ordinaryRouteLine = server.slice(server.indexOf("['/greenhouse/']"), server.indexOf('\n', server.indexOf("['/greenhouse/']")));
  assert.match(plannerRouteLine, /script-src 'self'/);
  assert.match(plannerRouteLine, /style-src 'self' 'unsafe-inline'/);
  assert.doesNotMatch(ordinaryRouteLine, /unsafe-inline/);
  assert.match(server, /connect-src 'self' http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
});
