import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { indexModelLimits, lookupContextLimit } from './model-limits.mjs';
import { cacheHitRate } from './cache-usage.mjs';

// Run the production handler with a captured HTTP transport and no catalog CLI.
// Integration cases use real SQLite and filesystem reads. win32/macOS path
// cases are simulations on Linux, not claims of native OS validation.
const source = fs.readFileSync(new URL('../service/main.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
function service(home, env = {}, paths = path, filesystem = fs) {
  let handler;
  const ctx = vm.createContext({
    http: { createServer(fn) { handler = fn; return { listen() {}, close() {} }; } },
    fs: filesystem, path: paths, os: { homedir: () => home }, DatabaseSync,
    execFile(_bin, _args, _opts, cb) { cb(new Error('No fixture catalog')); },
    process: { env: { OPENCHAMBER_SERVICE_PORT: '1', OPENCHAMBER_SERVICE_TOKEN: 'test', ...env }, on() {} },
    console, URL, indexModelLimits, lookupContextLimit, cacheHitRate,
  });
  vm.runInContext(source + '\nglobalThis.paths = { OPENCODE_DB, DCP_STORAGE_DIR }; globalThis.closeDb = () => dbConn?.close();', ctx);
  return { paths: ctx.paths, close: ctx.closeDb, inspect: () => new Promise((resolve, reject) => {
    handler({ headers: { authorization: 'Bearer test' }, url: '/inspect?sessionId=ses_test', method: 'GET' }, {
      writeHead(code) { assert.equal(code, 200); }, end(body) { resolve(JSON.parse(body)); },
    }).catch(reject);
  }) };
}
for (const [platform, paths, home, custom] of [
  ['Windows simulated', path.win32, 'C:\\Users\\Tester', 'D:\\Custom Data'],
  ['Linux', path.posix, '/home/tester', '/data/custom'],
  ['macOS simulated', path.posix, '/Users/tester', '/Volumes/Data/custom'],
]) {
  for (const override of [undefined, '', custom]) test(`${platform}: XDG=${JSON.stringify(override)}`, () => {
    const env = { LOCALAPPDATA: paths.join(home, 'AppData', 'Local'), APPDATA: paths.join(home, 'AppData', 'Roaming') };
    if (override !== undefined) env.XDG_DATA_HOME = override;
    const svc = service(home, env, paths, { existsSync() { throw new Error('Must not probe'); } });
    const root = paths.join(override || paths.join(home, '.local', 'share'), 'opencode');
    assert.equal(svc.paths.OPENCODE_DB, paths.join(root, 'opencode.db'));
    assert.equal(svc.paths.DCP_STORAGE_DIR, paths.join(root, 'storage', 'plugin', 'dcp'));
  });
}
function fixture(root, saved) {
  const data = path.join(root, 'opencode');
  fs.mkdirSync(path.join(data, 'storage', 'plugin', 'dcp'), { recursive: true });
  const db = new DatabaseSync(path.join(data, 'opencode.db'));
  db.exec('CREATE TABLE session_v2 (id, title, directory, model, cost, time_created, time_updated); CREATE TABLE session_message (session_id, type, seq, data);');
  db.prepare('INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?)').run('ses_test', `fixture-${saved}`, '', '{}', 0, 1, 2);
  const insert = db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?)');
  insert.run('ses_test', 'user', 1, JSON.stringify({ text: 'A real conversation payload' }));
  insert.run('ses_test', 'assistant', 2, JSON.stringify({ content: [{ type: 'tool', state: { input: 'test', content: 'A real tool payload' } }] }));
  db.close();
  fs.writeFileSync(path.join(data, 'storage', 'plugin', 'dcp', 'ses_test.json'), JSON.stringify({ stats: { totalPruneTokens: saved }, prune: { tools: { call: 123 } } }));
}
for (const mode of ['default', 'override', 'missing override', 'empty override', 'missing default', 'empty default', 'DB only', 'DCP only']) {
  test(`real SQLite and DCP: ${mode}, competing stale roots`, async (t) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'inspector-path-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const normal = path.join(home, '.local', 'share');
    const custom = path.join(home, 'custom');
    const legacy = path.join(home, 'AppData', 'Local');
    fixture(legacy, 999);
    const useOverride = mode.includes('override');
    const selected = useOverride ? custom : normal;
    if (useOverride) fixture(normal, 888);
    if (mode.startsWith('empty')) fs.mkdirSync(path.join(selected, 'opencode'), { recursive: true });
    else if (!mode.startsWith('missing')) fixture(selected, 456);
    if (mode === 'DB only') fs.rmSync(path.join(selected, 'opencode', 'storage'), { recursive: true });
    if (mode === 'DCP only') fs.rmSync(path.join(selected, 'opencode', 'opencode.db'));
    const svc = service(home, { LOCALAPPDATA: legacy, XDG_CONFIG_HOME: path.join(home, 'config'), ...(useOverride ? { XDG_DATA_HOME: custom } : {}) });
    try {
      const result = await svc.inspect();
      const absent = mode.startsWith('missing') || mode.startsWith('empty');
      assert.equal(result.session.found, !absent && mode !== 'DCP only');
      if (result.session.found) {
        assert.equal(result.session.title, 'fixture-456');
        assert.ok(result.session.rawEstimate.userTokens > 0);
        assert.ok(result.session.rawEstimate.toolTokens > 0);
      }
      assert.equal(result.dcp.totalSavedTokens, absent || mode === 'DB only' ? 0 : 456);
      assert.equal(result.dcp.prunedToolCount, absent || mode === 'DB only' ? 0 : 1);
    } finally { svc.close(); }
  });
}
