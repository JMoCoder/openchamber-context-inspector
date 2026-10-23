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
  let isZh = true;
  const openGroups = new Set(['mcp', 'conv', 'static']);

  function detectLang(locale) {
    const l = String(locale || navigator.language || '').toLowerCase();
    isZh = l.startsWith('zh');
  }
  detectLang();

  const L = () =>
    isZh
      ? {
          tools_io: '工具载荷',
          mcp: 'MCP 工具',
          native: '原生工具',
          skills: 'Skills 清单',
          sys_rules: '系统与规约',
          conversation: '对话消息',
          assistantMsgs: '助手消息',
          userMsgs: '用户消息',
          grpConv: '会话载荷',
          grpMcp: 'MCP 服务',
          grpStatic: '系统与工具基座',
          toolPrune: '工具修剪',
          noDcp: '当前会话暂无压缩记录',
          compressed: '已压缩',
          blocks: '块',
          ctxWindow: '上下文窗口',
          baseline: '基线',
          cacheRead: '缓存读取',
          incInput: '增量输入',
          output: '输出',
          totalCtx: '总上下文',
          used: '已用',
          thresholds: '阈值',
          softTip: '提醒阈值',
          midTip: '压缩阈值',
          hardTip: '强制限额',
          unknownWindow: '未知',
          dcpTitle: '压缩详情',
          breakdownTitle: '上下文构成',
          disabledMcp: '已停用 MCP',
        }
      : {
          tools_io: 'Tool Payloads',
          mcp: 'MCP Tools',
          native: 'Native Tools',
          skills: 'Skills',
          sys_rules: 'System & Rules',
          conversation: 'Conversation',
          assistantMsgs: 'Assistant',
          userMsgs: 'User',
          grpConv: 'Conversation Payloads',
          grpMcp: 'MCP Servers',
          grpStatic: 'System & Baseline',
          toolPrune: 'Tool Prune',
          noDcp: 'No compression records in this session',
          compressed: 'Compressed',
          blocks: 'blocks',
          ctxWindow: 'Context Window',
          baseline: 'Baseline',
          cacheRead: 'Cache Read',
          incInput: 'Input',
          output: 'Output',
          totalCtx: 'Total Context',
          used: 'Used',
          thresholds: 'Thresholds',
          softTip: 'Nudge',
          midTip: 'Compress',
          hardTip: 'Hard Limit',
          unknownWindow: 'Unknown',
          dcpTitle: 'Compression Details',
          breakdownTitle: 'Context Breakdown',
          disabledMcp: 'Disabled MCPs',
        };

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
    const i18n = L();
    const byId = Object.fromEntries((data.categories || []).map((c) => [c.id, c]));
    const unifiedCategories = [
      { id: 'tools_io', label: i18n.tools_io, tokens: byId.tools_io?.tokens ?? summary.toolTokens ?? 0 },
      { id: 'mcp', label: i18n.mcp, tokens: byId.mcp?.tokens ?? staticInfo.mcpTotalTokens ?? 0 },
      { id: 'native', label: i18n.native, tokens: byId.native?.tokens ?? staticInfo.nativeToolsTokens ?? 0 },
      { id: 'skills', label: i18n.skills, tokens: byId.skills?.tokens ?? staticInfo.skillsTokens ?? 0 },
      {
        id: 'sys_rules',
        label: i18n.sys_rules,
        tokens: byId.sys_rules?.tokens ?? ((staticInfo.harnessTokens || 0) + (staticInfo.rulesTokens || 0)),
      },
      {
        id: 'conversation',
        label: i18n.conversation,
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
      { name: i18n.tools_io, detail: `${session?.toolCallCount || 0} calls`, tokens: summary.toolTokens || 0 },
      { name: i18n.assistantMsgs, detail: `${session?.assistantCount || 0} messages`, tokens: summary.assistantTokens || 0 },
      { name: i18n.userMsgs, detail: `${session?.userCount || 0} messages`, tokens: summary.userTokens || 0 },
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
      { name: i18n.native, detail: `${staticInfo.nativeToolsCount} tools`, tokens: staticInfo.nativeToolsTokens },
      { name: i18n.skills, detail: `${staticInfo.skillsCount} skills`, tokens: staticInfo.skillsTokens },
      { name: i18n.sys_rules, detail: 'Harness + AGENTS.md', tokens: (staticInfo.harnessTokens || 0) + (staticInfo.rulesTokens || 0) },
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
        title: i18n.grpConv,
        count: (session?.userCount || 0) + (session?.assistantCount || 0),
        color: 'var(--oc-warning)',
        tokens: summary.dynamicTokens || 0,
        body: convRowsHtml,
      },
      {
        id: 'mcp',
        title: i18n.grpMcp,
        count: staticInfo.activeMcps.length,
        color: 'var(--oc-info)',
        tokens: staticInfo.mcpTotalTokens,
        body: mcpRowsHtml,
      },
      {
        id: 'static',
        title: i18n.grpStatic,
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
    const limitKnown = Number.isFinite(summary.contextLimit) && summary.contextLimit > 0;
    const usageLabel = limitKnown ? `${summary.usagePercent}%` : i18n.unknownWindow;
    const limitLabel = limitKnown ? fmt(summary.contextLimit) : i18n.unknownWindow;
    const totalBarWidth = limitKnown ? Math.min(100, Math.max(0, summary.usagePercent || 0)) : 0;
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
        ? `<div class="dcp-row"><span class="muted">${i18n.toolPrune} (${dcp.prunedToolCount})</span><span class="num">-${fmtK(dcp.prunedToolTokens)}</span></div>`
        : '';
    const dcpEmptyHtml = !dcpRowsHtml && !dcpToolRowHtml ? `<div class="sub">${i18n.noDcp}</div>` : '';
    const dcpSummaryRight =
      (dcp?.totalSavedTokens || 0) > 0
        ? `${i18n.compressed} ${fmtK(dcp.totalSavedTokens)}`
        : `${dcpBlocks.length} ${i18n.blocks}`;

    root.innerHTML = `
      <div class="grid">
        <div class="card">
          <div class="card-top">
            <span class="label">${i18n.ctxWindow}</span>
            <span class="sub num">${fmtK(summary.totalTokens)}</span>
          </div>
          <span class="big num">${usageLabel}</span>
          <span class="sub num">of ${limitLabel} · ${i18n.baseline} ${fmtK(summary.staticBaselineTokens)}</span>
        </div>
        <div class="card">
          <div class="card-top">
            <span class="label">${i18n.cacheRead}</span>
            <span class="sub num">${fmtK(summary.cacheRead)}</span>
          </div>
          <span class="big num">${summary.cacheHitRate}%</span>
          <span class="sub num">${i18n.incInput} ${fmt(summary.nonCachedInput)} · ${i18n.output} ${fmt(summary.outputTokens)}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-top">
          <span class="label">${i18n.totalCtx}</span>
          <span class="sub num">${fmt(summary.totalTokens)} / ${limitLabel}</span>
        </div>
        <div class="ctx-track">
          <span class="ctx-fill" style="width:${totalBarWidth.toFixed(1)}%"></span>
          <span class="ctx-tick" style="left:${minPct}%" title="${i18n.softTip} ${minPct}%"></span>
          <span class="ctx-tick mid" style="left:${maxPct}%" title="${i18n.midTip} ${maxPct}%"></span>
          <span class="ctx-tick max" style="left:${hardPct}%" title="${i18n.hardTip} ${hardPct}%"></span>
        </div>
        <div class="card-top" style="margin-top:2px">
          <span class="sub num">${i18n.used} ${usageLabel}</span>
          <span class="sub num">${i18n.thresholds} ${minPct}% / ${maxPct}% / ${hardPct}%</span>
        </div>
      </div>

      <div class="card">
        <div class="card-top">
          <span class="label">${i18n.dcpTitle}</span>
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
          <span class="label">${i18n.breakdownTitle}</span>
          <span class="sub num">${fmt(summary.totalTokens)} tokens</span>
        </div>
        <div class="meter-list">${meterListHtml}</div>
      </div>

      <div class="card">
        <div class="card-top">
          <span class="label">${i18n.disabledMcp}</span>
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

  const catalog = globalThis.ContextLimits.createCatalogCache(hostApiRequest, 10000);

  async function inspectWithCatalog(liveMcps) {
    let modelLimits = null;
    try {
      modelLimits = await catalog.load(false);
    } catch {}
    const ask = (limits) =>
      serviceRequest('/inspect', {
        sessionId: currentSessionId,
        directory: currentDirectory,
        liveMcps,
        modelLimits: limits,
      });
    let res = await ask(modelLimits);
    if (!res || res.status !== 200 || !res.body) return null;
    let data = JSON.parse(res.body);
    const model = data.session?.model;
    if (data.summary?.contextLimitSource === 'unknown' && model?.providerID && model?.id) {
      try {
        const fresh = await catalog.load(true);
        if (globalThis.ContextLimits.lookupContextLimit(fresh, model)) {
          res = await ask(fresh);
          if (res && res.status === 200 && res.body) data = JSON.parse(res.body);
        }
      } catch {}
    }
    return data;
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

      const data = await inspectWithCatalog(liveMcps);
      if (data) renderData(data);
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
