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

  const root = document.getElementById('root');
  let reqCounter = 0;
  const pending = new Map();
  let currentSessionId = '';
  let currentDirectory = '';
  const openGroups = new Set(['mcp', 'conv', 'static']);

  function sendToHost(msg) {
    window.parent.postMessage({ channel: CHANNEL, v: VERSION, ...msg }, '*');
  }

  function serviceRequest(pathUrl, bodyObj) {
    return new Promise((resolve, reject) => {
      const id = `oc-ci-${++reqCounter}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('TIMEOUT'));
      }, 7000);
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

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.v !== VERSION) return;

    if (data.type === 'ready') {
      if (data.payload?.theme) applyTheme(data.payload.theme);
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
    if (data.type === 'session-lifecycle' || data.type === 'directory') {
      if (data.payload?.directory) currentDirectory = data.payload.directory;
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

  const fmt = (n) => Number(n || 0).toLocaleString();
  const fmtK = (n) => {
    const v = Number(n || 0);
    return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
  };
  const fmtPct = (v) => {
    if (v <= 0) return '0%';
    if (v < 0.1) return '<0.1%';
    return v < 10 ? `${v.toFixed(1)}%` : `${Math.round(v)}%`;
  };

  const TONE_COLORS = {
    mcp: 'var(--oc-info)',
    native: 'var(--oc-primary)',
    skills: 'var(--oc-success)',
    sys_rules: 'color-mix(in srgb, var(--oc-primary) 55%, var(--oc-fg))',
    tools_io: 'var(--oc-warning)',
    conversation: 'var(--oc-muted)',
  };

  let lastPanelSig = '';
  let dcpCardOpen = true;
  function renderData(data, force = false) {
    const { session, staticInfo, summary, dcp } = data;
    const sig = JSON.stringify({
      sid: session?.sessionId,
      title: session?.title,
      sum: summary,
      dcp,
      act: (staticInfo?.activeMcps || []).map((m) => m.id),
      dis: (staticInfo?.disabledMcps || []).map((m) => m.id),
    });
    if (!force && sig === lastPanelSig) return;
    lastPanelSig = sig;
    const total = Math.max(1, summary.totalTokens);
    const byId = Object.fromEntries((data.categories || []).map((c) => [c.id, c]));
    const unifiedCategories = [
      { id: 'tools_io', label: '工具载荷', tokens: byId.tools_io?.tokens ?? summary.toolTokens ?? 0 },
      { id: 'mcp', label: 'MCP 工具', tokens: byId.mcp?.tokens ?? staticInfo.mcpTotalTokens ?? 0 },
      { id: 'native', label: '原生工具', tokens: byId.native?.tokens ?? staticInfo.nativeToolsTokens ?? 0 },
      { id: 'skills', label: 'Skills 清单', tokens: byId.skills?.tokens ?? staticInfo.skillsTokens ?? 0 },
      {
        id: 'sys_rules',
        label: '系统与规约',
        tokens: byId.sys_rules?.tokens ?? ((staticInfo.harnessTokens || 0) + (staticInfo.rulesTokens || 0)),
      },
      {
        id: 'conversation',
        label: '对话消息',
        tokens: byId.conversation?.tokens ?? ((summary.userTokens || 0) + (summary.assistantTokens || 0)),
      },
    ].sort((a, b) => b.tokens - a.tokens);

    const modelStr = session?.model?.id
      ? `${session.model.providerID || ''} / ${session.model.id}${session.model.variant ? ` · ${session.model.variant}` : ''}`
      : 'Default Model';

    const meterListHtml = unifiedCategories
      .map((c) => {
        const pct = (c.tokens / total) * 100;
        const barWidth = c.tokens > 0 ? Math.min(100, Math.max(2, pct)) : 0;
        const col = TONE_COLORS[c.id] || 'var(--oc-primary)';
        return `
          <div class="meter-line">
            <span class="what">${c.label}</span>
            <div class="meter"><span style="width:${barWidth.toFixed(1)}%;background:${col}"></span></div>
            <span class="value num">${fmtK(c.tokens)} · ${fmtPct(pct)}</span>
          </div>
        `;
      })
      .join('');

    const mcpRowsHtml = (staticInfo.activeMcps || [])
      .map((m) => {
        const pct = (m.tokens / total) * 100;
        return `
          <div class="row">
            <div>
              <div class="pname">${m.name}</div>
              <div class="pdetail">${m.tools} tools</div>
            </div>
            <span class="cell num muted">${fmtPct(pct)}</span>
            <span class="cell num">${fmtK(m.tokens)}</span>
          </div>
        `;
      })
      .join('');

    const convItems = [
      { name: '工具载荷', detail: `${session?.toolCallCount || 0} calls`, tokens: summary.toolTokens || 0 },
      { name: '助手消息', detail: `${session?.assistantCount || 0} messages`, tokens: summary.assistantTokens || 0 },
      { name: '用户消息', detail: `${session?.userCount || 0} messages`, tokens: summary.userTokens || 0 },
    ].sort((a, b) => b.tokens - a.tokens);

    const convRowsHtml = convItems
      .map((r) => {
        const pct = (r.tokens / total) * 100;
        return `
          <div class="row">
            <div>
              <div class="pname">${r.name}</div>
              <div class="pdetail">${r.detail}</div>
            </div>
            <span class="cell num muted">${fmtPct(pct)}</span>
            <span class="cell num">${fmtK(r.tokens)}</span>
          </div>
        `;
      })
      .join('');

    const staticItems = [
      { name: '原生工具', detail: `${staticInfo.nativeToolsCount} tools`, tokens: staticInfo.nativeToolsTokens },
      { name: 'Skills 清单', detail: `${staticInfo.skillsCount} skills`, tokens: staticInfo.skillsTokens },
      { name: '系统与规约', detail: 'Harness + AGENTS.md', tokens: (staticInfo.harnessTokens || 0) + (staticInfo.rulesTokens || 0) },
    ].sort((a, b) => b.tokens - a.tokens);

    const staticSum = staticItems.reduce((a, b) => a + b.tokens, 0);
    const staticRowsHtml = staticItems
      .map((r) => {
        const pct = (r.tokens / total) * 100;
        return `
          <div class="row">
            <div>
              <div class="pname">${r.name}</div>
              <div class="pdetail">${r.detail}</div>
            </div>
            <span class="cell num muted">${fmtPct(pct)}</span>
            <span class="cell num">${fmtK(r.tokens)}</span>
          </div>
        `;
      })
      .join('');

    const groups = [
      {
        id: 'conv',
        title: '会话载荷',
        count: (session?.userCount || 0) + (session?.assistantCount || 0),
        color: 'var(--oc-warning)',
        tokens: summary.dynamicTokens || 0,
        body: convRowsHtml,
      },
      {
        id: 'mcp',
        title: 'MCP 服务',
        count: staticInfo.activeMcps.length,
        color: 'var(--oc-info)',
        tokens: staticInfo.mcpTotalTokens,
        body: mcpRowsHtml,
      },
      {
        id: 'static',
        title: '系统与工具基座',
        count: 3,
        color: 'var(--oc-primary)',
        tokens: staticSum,
        body: staticRowsHtml,
      },
    ].sort((a, b) => b.tokens - a.tokens);

    const groupsHtml = groups
      .map((g) => {
        const pct = (g.tokens / total) * 100;
        const isOpen = openGroups.has(g.id) ? 'open' : '';
        return `
          <div class="group ${isOpen}" data-gid="${g.id}" style="--group-color:${g.color}">
            <div class="group-head">
              <span class="gname">
                <span class="dot" style="background:${g.color}"></span>
                <b>${g.title}</b>
                <span class="count num">${g.count}</span>
              </span>
              <span class="cell num">${fmtPct(pct)}</span>
              <span class="cell num">${fmtK(g.tokens)}</span>
            </div>
            <div class="group-body">${g.body}</div>
          </div>
        `;
      })
      .join('');

    const disabledPills = (staticInfo.disabledMcps || [])
      .map((m) => `<span class="port">${m.id}</span>`)
      .join('');

    const minPct = dcp?.minPct ?? 55;
    const maxPct = dcp?.maxPct ?? 75;
    const hardPct = 85;
    const totalBarWidth = Math.min(100, Math.max(1, summary.usagePercent || 0));
    const dcpBlocks = dcp?.blocks || [];
    const dcpRowsHtml = dcpBlocks
      .map(
        (b) => `
        <div class="dcp-row">
          <span><b>${b.id}</b> <span class="muted">${b.range}</span></span>
          <span class="num">${fmtK(b.compressedTokens)} → ${fmtK(b.summaryTokens)}</span>
        </div>`
      )
      .join('');
    const dcpToolRowHtml =
      (dcp?.prunedToolCount || 0) > 0
        ? `<div class="dcp-row"><span class="muted">工具修剪 (${dcp.prunedToolCount})</span><span class="num">-${fmtK(dcp.prunedToolTokens)}</span></div>`
        : '';
    const dcpEmptyHtml = !dcpRowsHtml && !dcpToolRowHtml ? `<div class="sub">当前会话暂无压缩记录</div>` : '';
    const dcpSummaryRight =
      (dcp?.totalSavedTokens || 0) > 0
        ? `已压缩 ${fmtK(dcp.totalSavedTokens)}`
        : `${dcpBlocks.length} 块`;

    root.innerHTML = `
      <div class="grid">
        <div class="card">
          <div class="card-top">
            <span class="label">上下文窗口</span>
            <span class="sub num">${fmtK(summary.totalTokens)}</span>
          </div>
          <span class="big num">${summary.usagePercent}%</span>
          <span class="sub num">of ${fmt(summary.contextLimit)} · 基线 ${fmtK(summary.staticBaselineTokens)}</span>
        </div>
        <div class="card">
          <div class="card-top">
            <span class="label">缓存读取</span>
            <span class="sub num">${fmtK(summary.cacheRead)}</span>
          </div>
          <span class="big num">${summary.cacheHitRate}%</span>
          <span class="sub num">增量输入 ${fmt(summary.nonCachedInput)} · 输出 ${fmt(summary.outputTokens)}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-top">
          <span class="label">总上下文</span>
          <span class="sub num">${fmt(summary.totalTokens)} / ${fmt(summary.contextLimit)}</span>
        </div>
        <div class="ctx-track">
          <span class="ctx-fill" style="width:${totalBarWidth.toFixed(1)}%"></span>
          <span class="ctx-tick" style="left:${minPct}%" title="提醒阈值 ${minPct}%"></span>
          <span class="ctx-tick mid" style="left:${maxPct}%" title="压缩阈值 ${maxPct}%"></span>
          <span class="ctx-tick max" style="left:${hardPct}%" title="强制限额 ${hardPct}%"></span>
        </div>
        <div class="card-top" style="margin-top:2px">
          <span class="sub num">已用 ${summary.usagePercent}%</span>
          <span class="sub num">阈值 ${minPct}% / ${maxPct}% / ${hardPct}%</span>
        </div>
      </div>

      <div class="card">
        <div class="card-top">
          <span class="label">压缩详情</span>
          <span class="sub num">${dcpSummaryRight}</span>
        </div>
        <div class="dcp-list">
          ${dcpRowsHtml}
          ${dcpToolRowHtml}
          ${dcpEmptyHtml}
        </div>
      </div>

      <div class="card">
        <div class="card-top">
          <span class="label">上下文构成</span>
          <span class="sub num">${fmt(summary.totalTokens)} tokens</span>
        </div>
        <div class="meter-list">${meterListHtml}</div>
      </div>

      <div class="card">
        <div class="card-top">
          <span class="label">已停用 MCP</span>
          <span class="sub num">${staticInfo.disabledMcps.length}</span>
        </div>
        <div class="ports">${disabledPills || '<span class="sub">None</span>'}</div>
      </div>

      <section class="section">
        <div class="cols">
          <span class="label">MODULES</span>
          <span class="cell">Share</span>
          <span class="cell">Tokens</span>
        </div>
        <div>${groupsHtml}</div>
      </section>
    `;

    root.querySelectorAll('.group-head').forEach((el) => {
      el.addEventListener('click', () => {
        const grp = el.closest('.group');
        if (!grp) return;
        const gid = grp.getAttribute('data-gid');
        if (openGroups.has(gid)) {
          openGroups.delete(gid);
          grp.classList.remove('open');
        } else {
          openGroups.add(gid);
          grp.classList.add('open');
        }
      });
    });

    const btn = document.getElementById('oc-ci-refresh');
    if (btn) btn.addEventListener('click', () => { lastPanelSig = ''; void refresh(); });
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

      const res = await serviceRequest('/inspect', {
        sessionId: currentSessionId,
        directory: currentDirectory,
        liveMcps,
      });
      if (res && res.status === 200 && res.body) {
        renderData(JSON.parse(res.body));
      }
    } catch {} finally {
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
