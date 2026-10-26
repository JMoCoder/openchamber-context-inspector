import assert from 'node:assert/strict';
import { cacheHitRate } from './cache-usage.mjs';

assert.equal(cacheHitRate({ input: 622, cache: { read: 73_984, write: 0 } }), 99.2);
assert.equal(cacheHitRate({ input: 100, cache: { read: 900, write: 1000 } }), 45);
assert.equal(cacheHitRate({ input: 100, cache: { read: 900 } }), 90);
assert.equal(cacheHitRate({ input: 100 }), 0);
assert.equal(cacheHitRate({ cache: { write: 1000 } }), 0);
assert.equal(cacheHitRate({ cache: { read: 1000 } }), 100);
assert.equal(cacheHitRate({ input: 100, output: 9999, reasoning: 8888, cache: { read: 900 } }), 90);
assert.equal(cacheHitRate({ output: 100 }), null);
assert.equal(cacheHitRate({ input: 0, cache: { read: 0, write: 0 } }), null);
assert.equal(cacheHitRate(undefined), null);

console.log('cache-usage.test.mjs ok');
