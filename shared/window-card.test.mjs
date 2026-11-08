import assert from 'node:assert/strict';
import fs from 'node:fs';
import { windowCardFacts, windowCardLines } from './window-card.mjs';

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const labels = {
  limit: '上限',
  remaining: '剩余',
  baseline: '基线',
  dynamic: '动态',
  unknown: '未知',
};

const known = windowCardLines(
  { totalTokens: 117_600, contextLimit: 200_000, staticBaselineTokens: 18_200, dynamicTokens: 99_400 },
  labels,
  fmt,
);
assert.equal(known.capacity, '上限 200,000 · 剩余 82,400');
assert.equal(known.composition, '基线 18,200 · 动态 99,400');

const over = windowCardFacts({ totalTokens: 210_000, contextLimit: 200_000 });
assert.equal(over.remaining, -10_000);

const unknown = windowCardLines(
  { totalTokens: 12_000, contextLimit: null, staticBaselineTokens: 8_000, dynamicTokens: 4_000 },
  labels,
  fmt,
);
assert.equal(unknown.capacity, '上限 未知 · 剩余 —');
assert.equal(unknown.composition, '基线 8,000 · 动态 4,000');
assert.equal(windowCardFacts({ contextLimit: 0 }).remaining, null);
assert.equal(windowCardFacts(undefined).dynamic, 0);

const panel = fs.readFileSync(new URL('../panel/main.js', import.meta.url), 'utf8');
assert.match(panel, /\$\{i18n\.limit\} \$\{limitLabel\} · \$\{i18n\.remaining\} \$\{remainingLabel\}/);
assert.match(
  panel,
  /\$\{i18n\.baseline\} \$\{fmt\(summary\.staticBaselineTokens \|\| 0\)\} · \$\{i18n\.dynamic\} \$\{fmt\(summary\.dynamicTokens \|\| 0\)\}/,
);
assert.equal(panel.includes('of ${limitLabel}'), false);

console.log('window-card.test.mjs ok');
