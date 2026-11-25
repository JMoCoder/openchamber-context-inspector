import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDesktopOpenCodeApi, createOpenCodeReader } from './opencode.mjs';

const a = path.resolve('workspace & one');
const b = path.resolve('workspace two');
const model = { providerID: 'fixture', id: 'model' };
const doc = (compaction) => ({ type: 'document', info: { compaction } });
const catalog = (directory, input) => ({
  location: { directory },
  data: [{ ...model, limit: { context: 100_000, input } }],
});

test('scopes CLI reads to the session directory, deduplicates polls, and refreshes without leaking old config', async () => {
  const calls = [];
  let now = 0;
  let buffer = '20%';
  const reader = createOpenCodeReader(async (route) => {
    const { pathname, searchParams } = new URL(route, 'http://localhost');
    const dir = searchParams.get('location[directory]');
    calls.push([pathname, dir]);
    if (pathname === '/api/info') return { version: '2.3.2' };
    assert.ok(dir === a || dir === b);
    if (pathname === '/api/model') return catalog(dir, dir === a ? 80_000 : 60_000);
    if (buffer == null) throw new Error('unavailable');
    return [doc({ buffer }), ...(dir === b ? [doc({ auto: false })] : [])];
  }, () => now);

  const [settingsA, modelA, duplicate] = await Promise.all([
    reader.compactionSettings(a), reader.modelLimits(a, model), reader.compactionSettings(a),
  ]);
  assert.deepEqual(settingsA, { auto: true, buffer: '20%' });
  assert.deepEqual(modelA, { limits: { context: 100_000, input: 80_000 }, scopeMatches: true });
  assert.equal(duplicate, settingsA);
  assert.deepEqual(calls.filter(([route]) => route === '/api/config'), [['/api/config', a]]);
  assert.deepEqual(await reader.compactionSettings(b), { auto: false, buffer: '20%' });
  assert.deepEqual((await reader.modelLimits(b, model)).limits, { context: 100_000, input: 60_000 });

  buffer = '30%';
  assert.equal(await reader.compactionSettings(a), settingsA);
  now = 10_000;
  assert.deepEqual(await reader.compactionSettings(a), { auto: true, buffer: '30%' });
  buffer = null;
  now = 20_000;
  assert.equal(await reader.compactionSettings(a), null);
  assert.equal(await reader.compactionSettings(a), null);
  assert.equal(calls.filter(([route, dir]) => route === '/api/config' && dir === a).length, 3);
});

test('recognizes a mismatched catalog location and does not backfill a threshold for older OpenCode', async () => {
  const reader = createOpenCodeReader(async (route) => {
    if (route === '/api/info') return { version: '2.2.0' };
    if (route.startsWith('/api/model?')) return catalog(b, 80_000);
    return [];
  });
  assert.equal((await reader.modelLimits(a, model)).scopeMatches, false);
  assert.equal(await reader.compactionSettings(a), null);
  assert.equal(await reader.compactionSettings(''), null);
});

async function desktopData(t, settings) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'context-inspector-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'settings.json'), JSON.stringify(settings));
  return path.join(root, 'guest-data', 'context-inspector');
}

test('Desktop MCP lists are scoped, cached, and separate from connectivity', async (t) => {
  const serviceData = await desktopData(t, { desktopLocalPort: 50123 });
  const calls = [];
  let now = 0;
  let location = a;
  const rows = [
    { name: 'connected', status: { status: 'connected' } },
    { name: 'offline', status: { status: 'failed', error: 'not needed by the panel' } },
    { name: 'auth', status: { status: 'needs_auth' } },
    { name: 'off', status: { status: 'disabled' } },
  ];
  const api = createDesktopOpenCodeApi(serviceData, async (route, options) => {
    const url = new URL(route);
    assert.equal(`${options.method} ${url.origin}${url.pathname}`, 'GET http://127.0.0.1:50123/api/mcp');
    const directory = url.searchParams.get('location[directory]');
    calls.push(directory);
    return Response.json(directory === b
      ? { location: { directory: b }, data: [] }
      : { location: { directory: location }, data: rows });
  });
  const reader = createOpenCodeReader(api, () => now);
  assert.equal(await reader.mcpLists(''), null);
  assert.deepEqual(await reader.mcpLists(a), { enabled: ['connected', 'offline', 'auth'], disabled: ['off'] });
  rows[2].status.status = 'disabled';
  assert.deepEqual(await reader.mcpLists(a), { enabled: ['connected', 'offline', 'auth'], disabled: ['off'] });
  assert.deepEqual(await reader.mcpLists(b), { enabled: [], disabled: [] });
  now = 10_000;
  assert.deepEqual(await reader.mcpLists(a), { enabled: ['connected', 'offline'], disabled: ['auth', 'off'] });
  location = b;
  now = 20_000;
  assert.equal(await reader.mcpLists(a), null);
  location = a;
  rows.push({ name: 'malformed' });
  now = 30_000;
  assert.equal(await reader.mcpLists(a), null);
  assert.deepEqual(calls, [a, b, a, a, a]);
});
