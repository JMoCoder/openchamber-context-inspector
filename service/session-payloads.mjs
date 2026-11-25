const textLength = (value) => typeof value === 'string' ? value.length : 0;
const payloadLength = (value) => value == null ? 0
  : typeof value === 'string' ? value.length : JSON.stringify(value).length;
const estimateTokens = (chars) => chars ? Math.max(1, Math.floor(chars / 4)) : 0;

function parseRecord(data) {
  try {
    const record = JSON.parse(data);
    return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
  } catch {
    return null;
  }
}

function assistantPayload() {
  return { assistantChars: 0, toolChars: 0, toolCallCount: 0 };
}

function addAssistantPart(payload, part, type = part?.type) {
  if (!part || typeof part !== 'object') return;
  if (type === 'text' || type === 'reasoning') {
    payload.assistantChars += textLength(part.text) || textLength(part.content);
  } else if (type === 'tool') {
    payload.toolCallCount++;
    const state = part.state;
    payload.toolChars += payloadLength(state?.input) + payloadLength(state?.content) + payloadLength(state?.error);
  }
}

function readProjectedParts(db, sessionId) {
  const byMessage = new Map();
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'session_part'").get()) {
    return byMessage;
  }

  const parts = db.prepare('SELECT message_id, type, data FROM session_part WHERE session_id = ?');
  for (const row of parts.iterate(sessionId)) {
    const part = parseRecord(row.data);
    if (!part) continue;
    let payload = byMessage.get(row.message_id);
    if (!payload) {
      payload = assistantPayload();
      byMessage.set(row.message_id, payload);
    }
    addAssistantPart(payload, part, row.type);
  }
  return byMessage;
}

export function readSessionPayloads(db, sessionId) {
  const projected = readProjectedParts(db, sessionId);
  const messages = db.prepare(`
    SELECT id, type, data FROM session_message
    WHERE session_id = ? AND type IN ('user', 'assistant') ORDER BY seq
  `);
  let userCount = 0;
  let userChars = 0;
  let assistantCount = 0;
  let lastTurnTokens = null;
  const total = assistantPayload();
  for (const row of messages.iterate(sessionId)) {
    const data = parseRecord(row.data);
    if (!data) continue;
    if (row.type === 'user') {
      userCount++;
      userChars += textLength(data.text);
      if (Array.isArray(data.content)) {
        for (const part of data.content) userChars += textLength(part?.text);
      }
      continue;
    }

    assistantCount++;
    const tok = data.tokens;
    if (tok && (tok.input > 0 || tok.cache?.read > 0 || tok.cache?.write > 0)) {
      lastTurnTokens = tok;
    }
    const parts = projected.get(row.id);
    if (parts) {
      total.assistantChars += parts.assistantChars;
      total.toolCallCount += parts.toolCallCount;
      total.toolChars += parts.toolChars;
    } else if (Array.isArray(data.content)) {
      // Older messages keep their parts inline. Do not count both representations.
      for (const part of data.content) addAssistantPart(total, part);
    }
  }

  return {
    userCount,
    assistantCount,
    toolCallCount: total.toolCallCount,
    rawEstimate: {
      userTokens: estimateTokens(userChars),
      assistantTokens: estimateTokens(total.assistantChars),
      toolTokens: estimateTokens(total.toolChars),
    },
    lastTurnTokens,
  };
}
