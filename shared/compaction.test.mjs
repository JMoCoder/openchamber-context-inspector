import assert from 'node:assert/strict';
import test from 'node:test';
import { autoCompaction, readCompactionSettings } from './compaction.mjs';

const doc = (compaction) => ({ type: 'document', info: { compaction } });
const threshold = (buffer, context, input) =>
  autoCompaction({ auto: true, buffer }, { context, input }).thresholdTokens;

test('matches OpenCode percentage and token buffers against its effective input window', () => {
  assert.equal(threshold('20%', 100_000), 80_000);
  assert.equal(threshold('30%', 100_000), 70_000);
  assert.equal(threshold('12.5%', 1_000, 999), 874);
  assert.equal(threshold('20%', 100_000, 80_000), 64_000);
  assert.equal(threshold('20%', 100_000, 110_000), 80_000);
  assert.equal(threshold('20%', 0, 50_000), 40_000);
  assert.equal(threshold(20_000, 100_000, 80_000), 60_000);
  assert.equal(threshold(0, 100_000), 100_000);
});

test('uses the native reserve rule when the buffer is missing or leaves no room', () => {
  assert.equal(threshold(undefined, 200_000), 170_000);
  assert.equal(threshold(undefined, 64_000), 48_000);
  assert.equal(threshold(undefined, 32_000), 16_000);
  assert.equal(threshold(undefined, 31_999), 27_200);
  assert.equal(threshold(64_000, 64_000), 48_000);
});

test('merges only supplied fields in OpenCode document order', () => {
  const entries = [
    doc({ auto: false, buffer: '20%' }),
    { type: 'directory', path: '/project/.opencode' },
    doc({ background: false, keep: { tokens: 50_000 }, buffer: '30%' }),
  ];
  assert.deepEqual(readCompactionSettings(entries), { auto: false, buffer: '30%' });
  assert.deepEqual(autoCompaction(readCompactionSettings(entries)), { enabled: false });
  assert.deepEqual(readCompactionSettings([...entries, doc({ auto: true })]), { auto: true, buffer: '30%' });
  assert.deepEqual(readCompactionSettings([]), { auto: true });
});

test('does not invent a default when config or model limits are unavailable', () => {
  for (const invalid of [null, {}, [doc('bad')], [doc({ auto: 'true' })], [doc({ buffer: '100%' })], [doc({ buffer: -1 })]]) {
    assert.equal(readCompactionSettings(invalid), null);
  }
  assert.equal(autoCompaction(null, { context: 100_000 }), null);
  assert.equal(autoCompaction({ auto: true }, { context: 0 }), null);
});
