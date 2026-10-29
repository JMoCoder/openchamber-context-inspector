import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { indexModelLimits, lookupContextLimit } from '../shared/model-limits.mjs';
import { cacheHitRate } from '../shared/cache-usage.mjs';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT || process.env.OPENCHAMBER_AGENT_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN || process.env.OPENCHAMBER_AGENT_TOKEN || '';

if (!port || !token) {
  console.error('OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required');
  process.exit(1);
}

const HOME = os.homedir();
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
const XDG_DATA =
  process.env.XDG_DATA_HOME ||
  (process.platform === 'win32' && process.env.LOCALAPPDATA
    ? process.env.LOCALAPPDATA
    : path.join(HOME, '.local', 'share'));

const AGENTS_MD = path.join(XDG_CONFIG, 'opencode', 'AGENTS.md');
const DCP_CONFIG = path.join(XDG_CONFIG, 'opencode', 'dcp.jsonc');
const DCP_STORAGE_DIR = path.join(XDG_DATA, 'opencode', 'storage', 'plugin', 'dcp');
const OPENCODE_DB = path.join(XDG_DATA, 'opencode', 'opencode.db');

function inspectDcp(sessionId) {
  let minPct = 55;
  let maxPct = 75;
  try {
    if (fs.existsSync(DCP_CONFIG)) {
      const raw = fs.readFileSync(DCP_CONFIG, 'utf8');
      const mMin = raw.match(/"minContextLimit"\s*:\s*"(\d+(?:\.\d+)?)%"/);
      const mMax = raw.match(/"maxContextLimit"\s*:\s*"(\d+(?:\.\d+)?)%"/);
      if (mMin) minPct = Number(mMin[1]);
      if (mMax) maxPct = Number(mMax[1]);
    }
  } catch {}

  const blocks = [];
  let prunedToolCount = 0;
  let prunedToolTokens = 0;
  let totalSavedTokens = 0;
  let pendingNudges = 0;

  try {
    if (sessionId) {
      const p = path.join(DCP_STORAGE_DIR, `${sessionId}.json`);
      if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        totalSavedTokens = Number(d?.stats?.totalPruneTokens || 0);
        const toolsObj = d?.prune?.tools || {};
        for (const v of Object.values(toolsObj)) {
          prunedToolCount++;
          prunedToolTokens += Number(v || 0);
        }
        const blocksObj = d?.prune?.messages?.blocksById || {};
        for (const b of Object.values(blocksObj)) {
          if (!b || typeof b !== 'object') continue;
          blocks.push({
            id: `@b${b.blockId}@`,
            topic: b.topic || 'Compressed Block',
            range: `${b.startId || ''} → ${b.endId || ''}`,
            compressedTokens: Number(b.compressedTokens || 0),
            summaryTokens: Number(b.summaryTokens || 0),
            savedTokens: Math.max(0, Number(b.compressedTokens || 0) - Number(b.summaryTokens || 0)),
            durationMs: Number(b.durationMs || 0),
            msgCount: Array.isArray(b.directMessageIds) ? b.directMessageIds.length : 0,
            toolCount: Array.isArray(b.directToolIds) ? b.directToolIds.length : 0,
            active: Boolean(b.active),
          });
        }
        const n = d?.nudges || {};
        pendingNudges =
          (Array.isArray(n.contextLimitAnchors) ? n.contextLimitAnchors.length : 0) +
          (Array.isArray(n.turnNudgeAnchors) ? n.turnNudgeAnchors.length : 0) +
          (Array.isArray(n.iterationNudgeAnchors) ? n.iterationNudgeAnchors.length : 0);
      }
    }
  } catch {}

  return {
    minPct,
    maxPct,
    totalSavedTokens,
    prunedToolCount,
    prunedToolTokens,
    pendingNudges,
    blocks,
  };
}

const MCP_PROFILES = {
  tinyfish: { name: 'tinyfish', tools: 32, tokens: 9200 },
  github: { name: 'github', tools: 46, tokens: 9800 },
  figma: { name: 'figma', tools: 42, tokens: 5400 },
  playwright: { name: 'playwright', tools: 25, tokens: 3400 },
  huggingface: { name: 'huggingface', tools: 4, tokens: 3100 },
  supabase: { name: 'supabase', tools: 20, tokens: 2800 },
  snyk: { name: 'snyk', tools: 14, tokens: 2600 },
  cloudflare: { name: 'cloudflare', tools: 18, tokens: 2400 },
  parallel: { name: 'parallel', tools: 2, tokens: 1950 },
  notion: { name: 'notion', tools: 12, tokens: 1800 },
  vercel: { name: 'vercel', tools: 10, tokens: 1500 },
  tldraw: { name: 'tldraw', tools: 6, tokens: 1450 },
  netlify: { name: 'netlify', tools: 8, tokens: 1200 },
  tavily: { name: 'tavily', tools: 5, tokens: 1100 },
  context7: { name: 'context7', tools: 2, tokens: 1000 },
  'pg-aiguide': { name: 'pg-aiguide', tools: 2, tokens: 650 },
  'mermaid-chart': { name: 'mermaid-chart', tools: 1, tokens: 450 },
  markitdown: { name: 'markitdown', tools: 1, tokens: 350 },
  exa: { name: 'exa', tools: 2, tokens: 320 },
  deepwiki: { name: 'deepwiki', tools: 3, tokens: 180 },
  'opencode-core': { name: 'opencode', tools: 7, tokens: 900, builtin: true },
};

const NATIVE_GROUPS = [
  { name: 'openchamber', meta: '6 tools', tokens: 3100 },
  { name: 'files & search', meta: '5 tools', tokens: 1450 },
  { name: 'execution', meta: '2 tools', tokens: 1050 },
  { name: 'agents & skills', meta: '3 tools', tokens: 950 },
  { name: 'context & web', meta: '3 tools', tokens: 650 },
];

function estimateTokensFromText(text) {
  if (!text) return 0;
  let cjk = 0;
  let ascii = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    else ascii++;
  }
  return Math.ceil(cjk * 0.65 + ascii * 0.25);
}

function discoverMcps(projectDir, liveMcps) {
  const activeMcps = [];
  const disabledMcps = [];

  if (Array.isArray(liveMcps) && liveMcps.length > 0) {
    for (const entry of liveMcps) {
      const id = entry.name;
      if (!id) continue;
      const st = entry.status?.status || 'disabled';
      const profile = MCP_PROFILES[id] || { name: id, tools: 5, tokens: 1000 };
      const item = { id, status: st, ...profile };
      if (st === 'connected') activeMcps.push(item);
      else disabledMcps.push(item);
    }
  } else {
    const configPaths = [
      path.join(HOME, '.config', 'opencode', 'opencode.json'),
      path.join(HOME, 'opencode.json'),
    ];
    if (projectDir && projectDir !== HOME) {
      configPaths.push(path.join(projectDir, 'opencode.json'));
      configPaths.push(path.join(projectDir, '.opencode', 'opencode.json'));
    }

    const mergedServers = new Map();
    for (const cp of configPaths) {
      try {
        if (!fs.existsSync(cp)) continue;
        const cfg = JSON.parse(fs.readFileSync(cp, 'utf8'));
        const servers = cfg?.mcp?.servers || {};
        for (const [id, srv] of Object.entries(servers)) {
          const prev = mergedServers.get(id) || {};
          mergedServers.set(id, { ...prev, ...srv });
        }
      } catch {}
    }

    for (const [id, srv] of mergedServers.entries()) {
      const profile = MCP_PROFILES[id] || { name: id, tools: 5, tokens: 1000 };
      const item = { id, ...profile };
      if (srv.disabled) disabledMcps.push(item);
      else activeMcps.push(item);
    }
  }

  activeMcps.push({ id: 'opencode-core', ...MCP_PROFILES['opencode-core'] });
  activeMcps.sort((a, b) => b.tokens - a.tokens);
  disabledMcps.sort((a, b) => b.tokens - a.tokens);

  return { activeMcps, disabledMcps };
}

let staticCache = { key: '', at: 0, globalAgentsTokens: 0, projectAgentsTokens: 0, skillsCount: 56, skillsTokens: 6400 };

function inspectStaticConfig(projectDir, liveMcps) {
  const now = Date.now();
  const cacheKey = String(projectDir || '');
  if (staticCache.key !== cacheKey || now - staticCache.at > 5000) {
    let globalAgentsTokens = 0;
    try {
      globalAgentsTokens = estimateTokensFromText(fs.readFileSync(AGENTS_MD, 'utf8'));
    } catch {}

    let projectAgentsTokens = 0;
    if (projectDir) {
      for (const name of ['AGENTS.md', 'CLAUDE.md']) {
        try {
          const p = path.join(projectDir, name);
          if (fs.existsSync(p)) {
            projectAgentsTokens += estimateTokensFromText(fs.readFileSync(p, 'utf8'));
          }
        } catch {}
      }
    }

    const seenSkills = new Map();
    const skillDirs = [
      path.join(HOME, '.agents', 'skills'),
      path.join(HOME, '.config', 'opencode', 'skills'),
    ];
    if (projectDir) skillDirs.push(path.join(projectDir, '.agents', 'skills'));

    for (const dir of skillDirs) {
      try {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) {
          if (seenSkills.has(entry)) continue;
          const skillMd = path.join(dir, entry, 'SKILL.md');
          if (fs.existsSync(skillMd)) {
            const text = fs.readFileSync(skillMd, 'utf8');
            const match = text.match(/description:\s*([\s\S]+?)(?:\n[a-zA-Z_-]+:|\n---)/);
            const desc = match ? match[1].trim() : text.slice(0, 240);
            const formatted = `<skill><id>${entry}</id><name>${entry}</name><description>${desc}</description></skill>`;
            seenSkills.set(entry, estimateTokensFromText(formatted));
          }
        }
      } catch {}
    }

    let skillsTokens = 0;
    for (const t of seenSkills.values()) skillsTokens += t;
    if (skillsTokens > 6400) skillsTokens = 6400;

    staticCache = {
      key: cacheKey,
      at: now,
      globalAgentsTokens,
      projectAgentsTokens,
      skillsCount: Math.min(seenSkills.size, 56),
      skillsTokens,
    };
  }

  const { activeMcps, disabledMcps } = discoverMcps(projectDir, liveMcps);
  const { globalAgentsTokens, projectAgentsTokens, skillsCount, skillsTokens } = staticCache;

  const mcpTotalTokens = activeMcps.reduce((acc, m) => acc + m.tokens, 0);
  const mcpTotalTools = activeMcps.reduce((acc, m) => acc + m.tools, 0);
  const nativeToolsTokens = 7200;
  const harnessTokens = 5350;
  const rulesTokens = globalAgentsTokens + projectAgentsTokens;

  return {
    activeMcps,
    disabledMcps,
    nativeGroups: NATIVE_GROUPS,
    mcpTotalTokens,
    mcpTotalTools,
    nativeToolsTokens,
    nativeToolsCount: 19,
    skillsTokens,
    skillsCount,
    rulesTokens,
    globalAgentsTokens,
    projectAgentsTokens,
    harnessTokens,
    staticBaselineTokens: mcpTotalTokens + nativeToolsTokens + skillsTokens + rulesTokens + harnessTokens,
  };
}

let dbConn = null;
function getDb() {
  if (!dbConn && fs.existsSync(OPENCODE_DB)) {
    dbConn = new DatabaseSync(OPENCODE_DB, { open: true, readOnly: true });
  }
  return dbConn;
}

async function querySessionDb(sessionId) {
  try {
    const db = getDb();
    if (!db) return { found: false };
    const row = sessionId
      ? db.prepare('SELECT id, title, directory, model, cost, time_created, time_updated FROM session_v2 WHERE id=? LIMIT 1').get(sessionId)
      : db.prepare('SELECT id, title, directory, model, cost, time_created, time_updated FROM session_v2 ORDER BY time_updated DESC LIMIT 1').get();

    if (!row) return { found: false };

    let modelInfo = {};
    try {
      modelInfo = row.model ? JSON.parse(row.model) : {};
    } catch {}

    const msgs = db.prepare('SELECT type, seq, data FROM session_message WHERE session_id=? ORDER BY seq ASC').all(row.id);

    let userChars = 0;
    let assistantChars = 0;
    let reasoningChars = 0;
    let toolChars = 0;
    let userCount = 0;
    let assistantCount = 0;
    let toolCallCount = 0;
    let lastTokens = null;

    for (const m of msgs) {
      let d;
      try {
        d = JSON.parse(m.data);
      } catch {
        continue;
      }
      if (m.type === 'user') {
        userCount++;
        userChars += String(d.text || '').length;
        if (Array.isArray(d.content)) {
          for (const part of d.content) {
            if (part && typeof part === 'object') userChars += String(part.text || '').length;
          }
        }
      } else if (m.type === 'assistant') {
        assistantCount++;
        const tok = d.tokens;
        if (tok && typeof tok === 'object' && ((tok.input || 0) > 0 || (tok.cache?.read || 0) > 0 || (tok.cache?.write || 0) > 0)) {
          lastTokens = tok;
        }
        if (Array.isArray(d.content)) {
          for (const item of d.content) {
            if (!item || typeof item !== 'object') continue;
            if (item.type === 'text') {
              assistantChars += String(item.text || '').length + String(item.content || '').length;
            } else if (item.type === 'reasoning') {
              reasoningChars += String(item.text || '').length + String(item.content || '').length;
            } else if (item.type === 'tool') {
              toolCallCount++;
              const st = item.state || {};
              toolChars +=
                JSON.stringify(st.input || '').length +
                JSON.stringify(st.content || '').length +
                String(st.error || '').length;
            }
          }
        }
      }
    }

    return {
      found: true,
      sessionId: row.id,
      title: row.title || 'Untitled',
      directory: row.directory,
      model: modelInfo,
      createdAt: row.time_created,
      updatedAt: row.time_updated,
      cost: row.cost || 0,
      userCount,
      assistantCount,
      toolCallCount,
      rawEstimate: {
        userTokens: userChars > 0 ? Math.max(1, Math.floor(userChars / 4)) : 0,
        assistantTokens: assistantChars + reasoningChars > 0 ? Math.max(1, Math.floor((assistantChars + reasoningChars) / 4)) : 0,
        toolTokens: toolChars > 0 ? Math.max(1, Math.floor(toolChars / 4)) : 0,
      },
      lastTurnTokens: lastTokens,
    };
  } catch (err) {
    dbConn = null;
    return { found: false, error: String(err) };
  }
}

const CATALOG_TTL_MS = 10_000;
let catalogLimits = null;
let catalogFetchedAt = 0;
let catalogInflight = null;

function opencodeBinary() {
  const candidates = [
    process.env.OPENCODE_BIN,
    path.join(HOME, '.local', 'bin', 'opencode'),
    '/opt/OpenChamber/resources/opencode-cli/opencode',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }
  return 'opencode';
}

function loadModelCatalog(force = false) {
  if (!force && catalogLimits && Date.now() - catalogFetchedAt < CATALOG_TTL_MS) {
    return Promise.resolve(catalogLimits);
  }
  if (catalogInflight) return catalogInflight;
  catalogInflight = new Promise((resolve) => {
    execFile(
      opencodeBinary(),
      ['api', 'get', '/api/model'],
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        catalogInflight = null;
        if (!err && stdout) {
          try {
            const limits = indexModelLimits(JSON.parse(stdout));
            if (Object.keys(limits).length > 0) {
              catalogLimits = limits;
              catalogFetchedAt = Date.now();
            }
          } catch {}
        }
        resolve(catalogLimits);
      },
    );
  });
  return catalogInflight;
}

async function resolveContextLimit(modelInfo) {
  let limits = await loadModelCatalog(false);
  let limit = lookupContextLimit(limits, modelInfo);
  if (limit == null && modelInfo?.providerID && (modelInfo.id || modelInfo.modelID)) {
    limits = await loadModelCatalog(true);
    limit = lookupContextLimit(limits, modelInfo);
  }
  return limit;
}

const sendJson = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (chunk) => {
      b += chunk.toString('utf8');
    });
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(''));
  });

const server = http.createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/inspect') {
    let sessionId = url.searchParams.get('sessionId') || '';
    let directory = url.searchParams.get('directory') || '';
    let liveMcps = null;

    if (req.method === 'POST') {
      try {
        const raw = await readBody(req);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.sessionId) sessionId = parsed.sessionId;
          if (parsed.directory) directory = parsed.directory;
          if (Array.isArray(parsed.liveMcps)) liveMcps = parsed.liveMcps;
        }
      } catch {}
    }

    const sessionData = await querySessionDb(sessionId);
    const targetDir = directory || sessionData?.directory || '';
    const staticInfo = inspectStaticConfig(targetDir, liveMcps);

    const lastTok = sessionData?.lastTurnTokens;
    const actualWindowTokens = lastTok
      ? (lastTok.input || 0) + (lastTok.cache?.read || 0) + (lastTok.cache?.write || 0) + (lastTok.output || 0)
      : 0;

    const cacheRead = lastTok?.cache?.read || 0;
    const cacheWrite = lastTok?.cache?.write || 0;
    const nonCachedInput = lastTok?.input || 0;

    const rawUser = sessionData?.rawEstimate?.userTokens || 0;
    const rawAssistant = sessionData?.rawEstimate?.assistantTokens || 0;
    const rawTool = sessionData?.rawEstimate?.toolTokens || 0;
    const rawConvTotal = rawUser + rawAssistant + rawTool;

    const baseStatic = staticInfo.staticBaselineTokens;

    let displayTotal = baseStatic + rawConvTotal;
    let effectiveToolTokens = rawTool;
    let effectiveUserTokens = rawUser;
    let effectiveAssistantTokens = rawAssistant;

    if (actualWindowTokens > 0) {
      displayTotal = actualWindowTokens;
      const dynamicBudget = Math.max(0, actualWindowTokens - baseStatic);
      if (rawConvTotal > 0 && dynamicBudget > 0) {
        const scale = dynamicBudget / rawConvTotal;
        effectiveUserTokens = Math.round(rawUser * scale);
        effectiveAssistantTokens = Math.round(rawAssistant * scale);
        effectiveToolTokens = Math.max(0, dynamicBudget - effectiveUserTokens - effectiveAssistantTokens);
      } else if (dynamicBudget === 0) {
        effectiveUserTokens = Math.min(rawUser, 500);
        effectiveAssistantTokens = Math.min(rawAssistant, 1500);
        effectiveToolTokens = 0;
      }
    }

    const categories = [
      {
        id: 'tools_io',
        label: 'Tool Payloads',
        tokens: effectiveToolTokens,
      },
      {
        id: 'mcp',
        label: 'MCP Tools',
        tokens: staticInfo.mcpTotalTokens,
      },
      {
        id: 'native',
        label: 'Native Tools',
        tokens: staticInfo.nativeToolsTokens,
      },
      {
        id: 'skills',
        label: 'Skills',
        tokens: staticInfo.skillsTokens,
      },
      {
        id: 'sys_rules',
        label: 'System & Rules',
        tokens: staticInfo.harnessTokens + staticInfo.rulesTokens,
      },
      {
        id: 'conversation',
        label: 'Conversation',
        tokens: effectiveUserTokens + effectiveAssistantTokens,
      },
    ].sort((a, b) => b.tokens - a.tokens);

    const dcp = inspectDcp(sessionData?.sessionId || sessionId);
    const contextLimit = await resolveContextLimit(sessionData?.model);
    const usagePercent =
      contextLimit == null
        ? null
        : Math.round((displayTotal / contextLimit) * 1000) / 10;

    sendJson(res, 200, {
      at: Date.now(),
      session: sessionData,
      staticInfo,
      dcp,
      summary: {
        totalTokens: displayTotal,
        actualWindowTokens,
        staticBaselineTokens: baseStatic,
        dynamicTokens: effectiveToolTokens + effectiveUserTokens + effectiveAssistantTokens,
        userTokens: effectiveUserTokens,
        assistantTokens: effectiveAssistantTokens,
        toolTokens: effectiveToolTokens,
        cacheRead,
        cacheWrite,
        nonCachedInput,
        outputTokens: lastTok?.output || 0,
        cacheHitRate: cacheHitRate(lastTok),
        contextLimit,
        contextLimitSource: contextLimit == null ? 'unknown' : 'catalog',
        usagePercent,
      },
      categories,
    });
    return;
  }

  sendJson(res, 404, { error: 'not-found' });
});

const shutdown = () => {
  server.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(port, '127.0.0.1');
