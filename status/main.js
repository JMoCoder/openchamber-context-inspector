(() => {
  const CHANNEL = 'openchamber.sdk';
  const VERSION = 1;

  const THEME_MAP = [
    ['--oc-bg', 'background'],
    ['--oc-elevated', 'elevated'],
    ['--oc-fg', 'foreground'],
    ['--oc-muted', 'muted'],
    ['--oc-subtle', 'subtle'],
    ['--oc-border', 'border'],
    ['--oc-hover', 'hover'],
    ['--oc-primary', 'primary'],
    ['--oc-muted-surface', 'mutedSurface'],
    ['--oc-success', 'success'],
    ['--oc-warning', 'warning'],
    ['--oc-error', 'error'],
    ['--oc-info', 'info'],
    ['--oc-font', 'font'],
    ['--oc-mono', 'mono'],
    ['--oc-radius', 'radius'],
  ];

  function applyTheme(theme) {
    if (!theme || !theme.tokens) return;
    const rootEl = document.documentElement;
    rootEl.style.colorScheme = theme.mode || 'dark';
    for (const [cssVar, key] of THEME_MAP) {
      if (theme.tokens[key]) rootEl.style.setProperty(cssVar, theme.tokens[key]);
    }
    if (theme.tokens.font) rootEl.style.setProperty('font-family', theme.tokens.font);
    if (theme.tokens.foreground) rootEl.style.setProperty('color', theme.tokens.foreground);
  }

  // Exact match with official Resource Monitor STATUS_STYLE & BASE_STYLE
  const STYLE = `
    html, body {
      margin: 0;
      background: transparent;
      color: var(--oc-fg);
      font: 12px/1.4 var(--oc-font);
      overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }
    * { box-sizing: border-box; }
    .num { font-variant-numeric: tabular-nums; }
    .muted { color: var(--oc-muted); }
    #root {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 2px 0 4px;
    }
    .line {
      display: grid;
      grid-template-columns: 78px minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 18px;
      cursor: pointer;
    }
    .line:hover .what {
      color: var(--oc-fg);
    }
    .line .what {
      color: var(--oc-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: color 0.12s ease;
    }
    .line .value {
      text-align: right;
      white-space: nowrap;
      color: var(--oc-fg);
    }
    .line .value .sub {
      color: var(--oc-muted);
      margin-left: 4px;
    }
    .meter {
      position: relative;
      height: 4px;
      border-radius: 2px;
      background: color-mix(in srgb, var(--oc-fg) 8%, transparent);
      overflow: hidden;
    }
    .meter > span {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      border-radius: 2px;
      transition: width 0.4s ease;
    }
    .note {
      color: var(--oc-muted);
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  document.head.appendChild(styleEl);

  const root = document.getElementById('root');
  let reqCounter = 0;
  const pending = new Map();
  let currentSessionId = '';
  let currentDirectory = '';
  let isZh = true;

  function detectLang(locale) {
    const l = String(locale || navigator.language || '').toLowerCase();
    isZh = l.startsWith('zh');
  }
  detectLang();

  const L = () =>
    isZh
      ? {
          mcp: 'MCP 工具',
          native: '原生工具',
          skills: 'Skills 清单',
          sys_rules: '系统与规约',
          tools_io: '工具载荷',
          conversation: '对话消息',
          reading: '正在读取上下文构成…',
        }
      : {
          mcp: 'MCP Tools',
          native: 'Native Tools',
          skills: 'Skills',
          sys_rules: 'System & Rules',
          tools_io: 'Tool Payloads',
          conversation: 'Conversation',
          reading: 'Reading context breakdown…',
        };

  function sendToHost(msg) {
    window.parent.postMessage({ channel: CHANNEL, v: VERSION, ...msg }, '*');
  }

  function serviceRequest(pathUrl, bodyObj) {
    return new Promise((resolve, reject) => {
      const id = `oc-cis-${++reqCounter}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('TIMEOUT'));
      }, 6000);
      pending.set(id, { resolve, reject, timer });
      sendToHost({
        type: 'service-request',
        id,
        payload: bodyObj
          ? { method: 'POST', path: pathUrl, body: JSON.stringify(bodyObj) }
          : { method: 'GET', path: pathUrl },
      });
    });
  }

  function hostApiRequest(pathUrl) {
    return new Promise((resolve, reject) => {
      const id = `oc-api-${++reqCounter}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('TIMEOUT'));
      }, 4500);
      pending.set(id, { resolve, reject, timer });
      sendToHost({
        type: 'request',
        id,
        payload: { method: 'GET', path: pathUrl },
      });
    });
  }

  let reportedHeight = -1;
  new ResizeObserver(() => {
    const h = Math.ceil(root.getBoundingClientRect().height);
    if (h > 0 && h !== reportedHeight) {
      reportedHeight = h;
      sendToHost({ type: 'resize', id: `oc-rz-${++reqCounter}`, payload: { height: h } });
    }
  }).observe(root);

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.v !== VERSION) return;
    if (data.type === 'ready') {
      if (data.payload?.theme) applyTheme(data.payload.theme);
      if (data.payload?.locale) detectLang(data.payload.locale);
      currentSessionId = data.payload?.session?.id || '';
      currentDirectory = data.payload?.directory || '';
      void refresh();
      return;
    }
    if (data.type === 'session') {
      currentSessionId = data.payload?.session?.id || '';
      void refresh();
      return;
    }
    if (data.type === 'session-lifecycle') {
      void refresh();
      return;
    }
    if (data.type === 'directory') {
      currentDirectory = data.payload?.directory || '';
      void refresh();
      return;
    }
    if (data.type === 'result') {
      const entry = pending.get(data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(data.id);
      if (data.ok) entry.resolve(data.payload);
      else entry.reject(new Error(data.error || 'ERR'));
    }
  });

  function fmtK(n) {
    const v = Number(n || 0);
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
    return String(v);
  }

  function fmtPct(v) {
    if (v <= 0) return '0%';
    if (v < 0.1) return '<0.1%';
    return v < 10 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
  }

  // Cohesive theme-native palette matching Resource Monitor
  const TONE_COLORS = {
    mcp: 'var(--oc-info)',
    native: 'var(--oc-primary)',
    skills: 'var(--oc-success)',
    sys_rules: 'color-mix(in srgb, var(--oc-primary) 55%, var(--oc-fg))',
    tools_io: 'var(--oc-warning)',
    conversation: 'var(--oc-muted)',
  };

  let lastStatusSig = '';
  function renderCompact(data) {
    const { summary, categories } = data;
    const sig = JSON.stringify({ t: summary?.totalTokens, c: categories });
    if (sig === lastStatusSig) return;
    lastStatusSig = sig;
    const total = Math.max(1, summary.totalTokens);
    const byId = Object.fromEntries((categories || []).map((c) => [c.id, c]));

    const i18n = L();
    const rows = [
      {
        id: 'mcp',
        label: i18n.mcp,
        tokens: byId.mcp?.tokens || 0,
        color: TONE_COLORS.mcp,
        tip: byId.mcp?.detail || '',
      },
      {
        id: 'native',
        label: i18n.native,
        tokens: byId.native?.tokens || 0,
        color: TONE_COLORS.native,
        tip: byId.native?.detail || '',
      },
      {
        id: 'skills',
        label: i18n.skills,
        tokens: byId.skills?.tokens || 0,
        color: TONE_COLORS.skills,
        tip: byId.skills?.detail || '',
      },
      {
        id: 'sys_rules',
        label: i18n.sys_rules,
        tokens: byId.sys_rules?.tokens ?? ((byId.harness?.tokens || 0) + (byId.rules?.tokens || 0)),
        color: TONE_COLORS.sys_rules,
        tip: i18n.sys_rules,
      },
      {
        id: 'tools_io',
        label: i18n.tools_io,
        tokens: byId.tools_io?.tokens || 0,
        color: TONE_COLORS.tools_io,
        tip: byId.tools_io?.detail || '',
      },
      {
        id: 'conversation',
        label: i18n.conversation,
        tokens: byId.conversation?.tokens || 0,
        color: TONE_COLORS.conversation,
        tip: byId.conversation?.detail || '',
      },
    ];

    rows.sort((a, b) => b.tokens - a.tokens);

    const linesHtml = rows
      .map((r) => {
        const pct = (r.tokens / total) * 100;
        const barWidth = r.tokens > 0 ? Math.min(100, Math.max(2, pct)) : 0;
        return `
          <div class="line" data-open-panel="true" title="${r.tip}">
            <span class="what">${r.label}</span>
            <div class="meter"><span style="width:${barWidth.toFixed(1)}%;background:${r.color}"></span></div>
            <span class="value num">${fmtK(r.tokens)} · ${fmtPct(pct)}</span>
          </div>
        `;
      })
      .join('');

    root.innerHTML = linesHtml;

    root.querySelectorAll('[data-open-panel]').forEach((el) => {
      el.addEventListener('click', () => {
        sendToHost({
          type: 'open-surface',
          id: `oc-os-${++reqCounter}`,
          payload: { surfaceId: 'ext:context-inspector' },
        });
      });
    });
  }

  async function inspectSession(liveMcps) {
    const res = await serviceRequest('/inspect', {
      sessionId: currentSessionId,
      directory: currentDirectory,
      liveMcps,
    });
    if (!res || res.status !== 200 || !res.body) return null;
    return JSON.parse(res.body);
  }

  let inflight = false;
  async function refresh() {
    if (inflight || document.hidden) return;
    inflight = true;
    try {
      let liveMcps = null;
      try {
        const mcpRes = await hostApiRequest('/api/mcp');
        if (mcpRes && mcpRes.status === 200 && mcpRes.body) {
          const parsed = JSON.parse(mcpRes.body);
          if (Array.isArray(parsed.data)) liveMcps = parsed.data;
        }
      } catch {}

      const data = await inspectSession(liveMcps);
      if (data) renderCompact(data);
    } catch {
      root.innerHTML = `<div class="note">${L().reading}</div>`;
    } finally {
      inflight = false;
    }
  }

  sendToHost({ type: 'hello' });
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
})();
