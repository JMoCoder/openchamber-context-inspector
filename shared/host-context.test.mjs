import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../panel/main.js', import.meta.url), 'utf8');
const envelope = { channel: 'openchamber.sdk', v: 1 };
const omitted = Symbol('omitted');
const session = (id, context = omitted) => ({
  id, title: id, busy: false,
  ...(context === omitted ? {} : { context }),
});

function setup() {
  const sent = [];
  const listeners = {};
  const root = { innerHTML: '', querySelectorAll: () => [] };
  const win = {
    parent: { postMessage: (message) => sent.push(message) },
    addEventListener: (type, cb) => { listeners[type] = cb; },
  };
  let tick;
  vm.runInNewContext(source, {
    window: win,
    document: {
      getElementById: (id) => id === 'root' ? root : null,
      addEventListener: () => {},
      hidden: false,
    },
    navigator: { language: 'en-US' },
    setInterval: (cb) => { tick = cb; },
    setTimeout: () => 1,
    clearTimeout: () => {},
  }, { filename: 'panel/main.js' });

  const emit = (type, payload, extra = {}) => listeners.message({
    source: win.parent, data: { ...envelope, type, payload, ...extra },
  });
  const take = (type) => {
    const i = sent.findIndex((m) => m.type === type);
    assert.notEqual(i, -1, `expected pending ${type}; had ${sent.map((m) => m.type)}`);
    return sent.splice(i, 1)[0];
  };
  const settle = (req, body) => emit('result', { status: 200, body: JSON.stringify(body) }, { id: req.id, ok: true });
  return {
    sent, emit, take, settle, tick,
    html: () => root.innerHTML,
    ready: (value, directory = '/project') => emit('ready', { session: value, directory }),
    update: (value) => emit('session', { session: value }),
    async takeInspect() {
      settle(take('request'), { data: [] });
      await setImmediate();
      return take('service-request');
    },
  };
}

function inspectData(id, options = {}) {
  return {
    session: { sessionId: id, title: id },
    staticInfo: { activeMcps: [], disabledMcps: [], mcpTotalTokens: 110, nativeToolsCount: 2, nativeToolsTokens: 100, skillsCount: 2, skillsTokens: 90 },
    summary: {
      totalTokens: 600, contextLimit: 1000, usagePercent: 60,
      nativeCompaction: { enabled: true, thresholdTokens: 800 },
      staticBaselineTokens: 300, dynamicTokens: 300,
      cacheRead: 111, cacheWrite: 22, cacheHitRate: 12.5, nonCachedInput: 300, outputTokens: 44,
      ...options,
    },
    categories: ['tools_io', 'mcp', 'native', 'skills', 'sys_rules', 'conversation'].map((id, index) => ({ id, tokens: (index + 1) * 30 })),
    dcp: { minPct: 57, maxPct: 77, blocks: [{ id: 'DCP-fixture', range: '1..2', compressedTokens: 55, summaryTokens: 12 }] },
  };
}

test('v2.8.0 wire ready/session use native headline independently of the local detail and cumulative cache metrics', async () => {
  const panel = setup();
  assert.equal(panel.take('hello').type, 'hello');
  panel.ready(session('alpha', { tokens: 200, limit: 1000 }));
  assert.match(panel.html(), /20%/);
  panel.emit('directory', { directory: '/project' });
  panel.update({ ...session('alpha', { tokens: 200, limit: 1000 }), tokens: { cacheHitPercent: 99 } });
  const req = await panel.takeInspect();
  assert.deepEqual(JSON.parse(req.payload.body), { sessionId: 'alpha', directory: '/project', liveMcps: [], includeCompaction: true });
  assert.equal(panel.sent.length, 0, 'duplicate ready/directory/session snapshots do not start duplicate inspections');
  panel.settle(req, inspectData('alpha'));
  await setImmediate();

  assert.match(panel.html(), /200 \/ 1,000/);
  assert.match(panel.html(), /width:20\.0%/);
  assert.match(panel.html(), /Limit 1,000 · Remaining 800/);
  assert.doesNotMatch(panel.html(), /600 \/ 1,000|99%/);
  assert.match(panel.html(), /Context Breakdown[\s\S]*600 tokens/);
  assert.match(panel.html(), /Conversation[\s\S]*30%/); // 180 / local 600, not / host 200
  assert.match(panel.html(), /12\.5%/);
  assert.match(panel.html(), /DCP-fixture/);
  assert.match(panel.html(), /DCP 57% \/ 77% · OpenCode 80%/);
  assert.match(panel.html(), /class="ctx-tick native" style="left:80%"/);

  panel.update(session('alpha', { tokens: 300, limit: 2000 }));
  assert.match(panel.html(), /300 \/ 2,000/);
  assert.match(panel.html(), /width:15\.0%/);
  assert.match(panel.html(), /Limit 2,000 · Remaining 1,700/);
  assert.doesNotMatch(panel.html(), /ctx-tick native/);
  assert.equal(panel.sent.length, 0, 'same-session native updates render without another local poll');
});

test('Chinese threshold caption shows only OpenCode and the percentage', async () => {
  const panel = setup();
  panel.take('hello');
  panel.emit('ready', { session: session('alpha', { tokens: 200, limit: 628_000 }), directory: '/project', locale: 'zh-CN' });
  const req = await panel.takeInspect();
  const data = inspectData('alpha', {
    contextLimit: 628_000,
    nativeCompaction: { enabled: true, thresholdTokens: 475_000 },
  });
  panel.settle(req, { ...data, dcp: { ...data.dcp, minPct: 40, maxPct: 60 } });
  await setImmediate();

  assert.match(panel.html(), />DCP 40% \/ 60% · OpenCode 75\.6%<\/span>/);
  assert.match(panel.html(), /title="OpenCode 自动压缩 75\.6% \(/);
});

test('explicit null, unknown limit, and zero stay distinct even after a local poll', async () => {
  const panel = setup();
  panel.take('hello');
  panel.ready(session('alpha', { tokens: 200, limit: 1000 }));
  const req = await panel.takeInspect();
  panel.update(session('alpha', null));
  assert.match(panel.html(), /Unmeasured/);
  assert.doesNotMatch(panel.html(), /20%/);
  panel.settle(req, inspectData('alpha'));
  await setImmediate();

  assert.match(panel.html(), /— \/ Unknown/);
  assert.match(panel.html(), /Unmeasured/);
  assert.match(panel.html(), /Limit Unknown · Remaining —/);
  assert.doesNotMatch(panel.html(), /ctx-tick native/);
  assert.doesNotMatch(panel.html(), /600 \/ 1,000/);
  assert.match(panel.html(), /DCP-fixture|12\.5%/);

  panel.update(session('alpha', { tokens: 450, limit: null }));
  assert.match(panel.html(), /450 \/ Unknown/);
  assert.match(panel.html(), /Limit Unknown · Remaining —/);
  assert.doesNotMatch(panel.html(), /Unmeasured/);

  panel.update(session('alpha', { tokens: 0, limit: 1000 }));
  assert.match(panel.html(), /0 \/ 1,000/);
  assert.match(panel.html(), /Limit 1,000 · Remaining 1,000/);
  assert.match(panel.html(), />0%<\/span>/);
});

test('older host omission keeps local fallback; a real null session never asks for the newest database row', async () => {
  const panel = setup();
  panel.take('hello');
  panel.ready(session('legacy'));
  const req = await panel.takeInspect();
  panel.settle(req, inspectData('legacy'));
  await setImmediate();

  assert.match(panel.html(), /600 \/ 1,000/);
  assert.match(panel.html(), /Limit 1,000 · Remaining 400/);
  assert.match(panel.html(), /width:60\.0%/);
  panel.update(null);
  panel.tick();
  assert.equal(panel.html(), '');
  assert.equal(panel.sent.length, 0);
});

test('A→B→A discards an older inspection with the same session ID', async () => {
  const panel = setup();
  panel.take('hello');
  panel.ready(session('alpha', { tokens: 200, limit: 1000 }));
  const old = await panel.takeInspect();
  panel.update(session('beta', null));
  assert.match(panel.html(), /Unmeasured/);
  assert.doesNotMatch(panel.html(), /20%/);
  panel.update(session('alpha', { tokens: 700, limit: 1000 }));
  panel.settle(old, inspectData('alpha', { cacheHitRate: 98.7 }));
  await setImmediate();
  assert.doesNotMatch(panel.html(), /98\.7%|DCP-fixture/);
  assert.match(panel.html(), /70%/);
  const fresh = await panel.takeInspect();
  assert.equal(JSON.parse(fresh.payload.body).sessionId, 'alpha');
  panel.settle(fresh, inspectData('alpha'));
  await setImmediate();
  assert.match(panel.html(), /700 \/ 1,000/);
  assert.match(panel.html(), /12\.5%/);
});

test('directory change during MCP lookup starts only the new scope’s inspection', async () => {
  const panel = setup();
  panel.take('hello');
  panel.ready(session('alpha', { tokens: 200, limit: 1000 }));
  const staleMcp = panel.take('request');
  panel.emit('directory', { directory: '/new-project' });
  panel.settle(staleMcp, { data: [] });
  await setImmediate();
  assert.equal(panel.html(), '');
  assert.equal(panel.sent.length, 0);

  panel.update(session('beta', { tokens: 800, limit: 1000 }));
  const fresh = await panel.takeInspect();
  assert.deepEqual(JSON.parse(fresh.payload.body), { sessionId: 'beta', directory: '/new-project', liveMcps: [], includeCompaction: true });
  panel.settle(fresh, inspectData('alpha'));
  await setImmediate();
  assert.match(panel.html(), /80%/);
  assert.doesNotMatch(panel.html(), /DCP-fixture/);
});

test('the native line refreshes independently of DCP and disappears when disabled or unknown', async () => {
  const panel = setup();
  panel.take('hello');
  panel.ready(session('alpha', { tokens: 300, limit: 1000 }));
  const show = async (nativeCompaction, first = false) => {
    if (!first) panel.tick();
    const req = await panel.takeInspect();
    // No DCP installation or records in this fixture.
    const { dcp, ...data } = inspectData('alpha', { nativeCompaction });
    panel.settle(req, data);
    await setImmediate();
  };

  await show({ enabled: true, thresholdTokens: 800 }, true);
  assert.match(panel.html(), /DCP 55% \/ 75% · OpenCode 80%/);
  assert.match(panel.html(), /left:80%" title="OpenCode Auto Compaction 80% \(800 tokens\)/);
  await show({ enabled: true, thresholdTokens: 700 });
  assert.match(panel.html(), /DCP 55% \/ 75% · OpenCode 70%/);
  assert.doesNotMatch(panel.html(), /left:80%/);
  for (const [status, label] of [[{ enabled: false }, 'Off'], [null, 'Unknown']]) {
    await show(status);
    assert.match(panel.html(), new RegExp(`DCP 55% / 75% · OpenCode ${label}`));
    assert.doesNotMatch(panel.html(), /ctx-tick native|Hard Limit/);
  }
});
