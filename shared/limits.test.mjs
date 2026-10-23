import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const sandbox = {};
sandbox.globalThis = sandbox;
runInContext(fs.readFileSync(new URL('./limits.js', import.meta.url), 'utf8'), createContext(sandbox));
const { indexModelLimits, lookupContextLimit, positiveInt } = sandbox.ContextLimits;

const catalog = {
  data: [
    {
      providerID: 'dream-gpt',
      id: 'gpt-6.1-sol',
      modelID: 'gpt-6.1-sol',
      limit: { context: 5_000_000, output: 128_000 },
    },
    {
      providerID: 'dream-grok',
      id: 'grok-4.7',
      limit: { context: 200_000, output: 128_000 },
    },
    {
      providerID: 'openrouter',
      id: 'openai/gpt-6.1-sol',
      modelID: 'openai/gpt-6.1-sol',
      limit: { context: 1_050_000 },
    },
    {
      providerID: 'broken',
      id: 'no-limit',
      limit: {},
    },
  ],
};

const limits = indexModelLimits(catalog);

assert.equal(lookupContextLimit(limits, { providerID: 'dream-gpt', id: 'gpt-6.1-sol' }), 5_000_000);
assert.equal(lookupContextLimit(limits, { providerID: 'dream-grok', id: 'grok-4.7' }), 200_000);
assert.equal(lookupContextLimit(limits, { providerID: 'openrouter', id: 'openai/gpt-6.1-sol' }), 1_050_000);
assert.equal(lookupContextLimit(limits, { providerID: 'dream-gpt', id: 'missing' }), null);
assert.equal(lookupContextLimit(limits, { id: 'gpt-6.1-sol' }), null);
assert.equal(positiveInt(0), null);
assert.equal(positiveInt(-1), null);
assert.equal(positiveInt('5000000'), 5_000_000);
assert.equal(Object.hasOwn(limits, 'broken/no-limit'), false);

console.log('limits.test.mjs ok');
