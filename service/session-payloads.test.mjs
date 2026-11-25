import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { readSessionPayloads } from './session-payloads.mjs';

function fixture(t, { projected = true } = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE session_message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
      seq INTEGER NOT NULL, data TEXT NOT NULL
    );
  `);
  if (projected) {
    db.exec(`
      CREATE TABLE session_part (
        message_id TEXT NOT NULL, session_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
        type TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (message_id, ordinal)
      );
      CREATE INDEX session_part_session_message_idx ON session_part (session_id, message_id, ordinal);
    `);
  }

  return {
    db,
    message: (id, type, seq, data, session = 'target') => {
      db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?)').run(id, session, type, seq, JSON.stringify(data));
    },
    part: (id, ordinal, data, session = 'target') => {
      db.prepare('INSERT INTO session_part VALUES (?, ?, ?, ?, ?)').run(id, session, ordinal, data.type, JSON.stringify(data));
    },
  };
}

test('reads assistant and tool payloads from OpenCode V2 parts while keeping the latest input usage', (t) => {
  const { db, message, part } = fixture(t);
  const latest = { input: 0, cache: { read: 24, write: 2 }, output: 5 };
  message('user', 'user', 1, { text: 'user text' });
  message('first', 'assistant', 2, { content: [], tokens: { input: 10, output: 2 } });
  message('second', 'assistant', 3, { content: [], tokens: latest });
  message('third', 'assistant', 4, { content: [], tokens: { output: 2 } });
  part('first', 0, { type: 'text', text: 'answer!!' });
  part('first', 1, { type: 'reasoning', text: 'reason!!' });
  const input = { query: 'example' };
  const content = [{ type: 'text', text: 'result text' }];
  const error = { type: 'fixture', message: 'error payload' };
  part('second', 0, { type: 'tool', state: { status: 'completed', input, content, metadata: { extra: 'ignored' } } });
  part('third', 0, { type: 'tool', state: { status: 'error', error } });

  const toolChars = JSON.stringify(input).length + JSON.stringify(content).length + JSON.stringify(error).length;
  assert.deepEqual(readSessionPayloads(db, 'target'), {
    userCount: 1,
    assistantCount: 3,
    toolCallCount: 2,
    rawEstimate: { userTokens: 2, assistantTokens: 4, toolTokens: Math.floor(toolChars / 4) },
    lastTurnTokens: latest,
  });
});

test('keeps inline messages on an older database without the parts table', (t) => {
  const { db, message } = fixture(t, { projected: false });
  message('user', 'user', 1, { content: [{ type: 'text', text: 'legacy user text' }] });
  message('inline', 'assistant', 2, { content: [
    { type: 'text', content: 'old text' },
    { type: 'reasoning', text: 'thinking' },
    { type: 'tool', state: { input: 'request!', error: 'failure!' } },
  ] });
  assert.deepEqual(readSessionPayloads(db, 'target'), {
    userCount: 1,
    assistantCount: 1,
    toolCallCount: 1,
    rawEstimate: { userTokens: 4, assistantTokens: 4, toolTokens: 4 },
    lastTurnTokens: null,
  });
});

test('uses parts once per message, falls back independently, and stays in the selected session', (t) => {
  const { db, message, part } = fixture(t);
  const tool = { type: 'tool', state: { input: '12345678' } };
  message('projected', 'assistant', 1, { content: [{ type: 'text', text: 'old' }, tool] });
  part('projected', 0, { type: 'text', text: '12345678' });
  part('projected', 1, tool);
  message('inline', 'assistant', 2, { content: [{ type: 'text', text: '1234' }, tool] });
  db.prepare('INSERT INTO session_part VALUES (?, ?, ?, ?, ?)').run('inline', 'target', 0, 'tool', 'invalid JSON');
  message('other', 'assistant', 1, { content: [] }, 'separate');
  part('other', 0, tool, 'separate');
  message('idle', 'idle', 3, { content: [tool] });

  assert.deepEqual(readSessionPayloads(db, 'target'), {
    userCount: 0,
    assistantCount: 2,
    toolCallCount: 2,
    rawEstimate: { userTokens: 0, assistantTokens: 3, toolTokens: 4 },
    lastTurnTokens: null,
  });
});

test('counts an unmeasured tool call without inventing a payload', (t) => {
  const { db, message, part } = fixture(t);
  message('empty', 'assistant', 1, { content: [] });
  part('empty', 0, { type: 'tool', state: { status: 'pending' } });
  const usage = readSessionPayloads(db, 'target');
  assert.equal(usage.assistantCount, 1);
  assert.equal(usage.toolCallCount, 1);
  assert.deepEqual(usage.rawEstimate, { userTokens: 0, assistantTokens: 0, toolTokens: 0 });
});
