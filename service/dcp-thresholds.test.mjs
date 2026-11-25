import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readDcpThresholds } from './dcp-thresholds.mjs';

const unknown = { minPct: null, maxPct: null, minTokens: null, maxTokens: null };

function configDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'context-inspector-dcp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, write: (name, text) => writeFileSync(join(dir, name), text) };
}

test('missing DCP configuration does not invent thresholds', (t) => {
  const { dir } = configDir(t);
  assert.deepEqual(readDcpThresholds(dir), unknown);
});

test('reads the explicit compression fields in JSONC, not comments or unrelated keys', (t) => {
  const { dir, write } = configDir(t);
  write('dcp.jsonc', `{
    "$schema": "https://example.com/dcp.json",
    "minContextLimit": "12%",
    "compress": {
      // "minContextLimit": "55%",
      "minContextLimit": "40.5%",
      /* "maxContextLimit": "75%", */
      "maxContextLimit": "60%",
    },
  }`);
  assert.deepEqual(readDcpThresholds(dir), { ...unknown, minPct: 40.5, maxPct: 60 });
});

test('accepts explicit token limits and keeps missing or invalid thresholds independent', (t) => {
  const { dir, write } = configDir(t);
  write('dcp.json', '{"compress":{"minContextLimit":"101%","maxContextLimit":120000}}');
  assert.deepEqual(readDcpThresholds(dir), { ...unknown, maxTokens: 120000 });

  write('dcp.jsonc', '{"compress":{"minContextLimit":"0%"}}');
  assert.deepEqual(readDcpThresholds(dir), { ...unknown, minPct: 0 });

  write('dcp.jsonc', '{"compress":{"minContextLimit":"40%"}');
  assert.deepEqual(readDcpThresholds(dir), unknown);
});
