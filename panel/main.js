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
  let hostContext; // undefined means an older host omitted the field.
  let scopeGeneration = 0;
  let awaitingDirectorySession = false;
  let lastInspectData = null;
  let isZh = false;
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
          limit: '上限',
          remaining: '剩余',
          baseline: '基线',
          dynamic: '动态',
          dynamicTip: '本地构成估算，含用户消息、助手消息和工具载荷。',
          hostContextTip: 'OpenChamber 报告的最近一个助手步骤的窗口用量。',
          unmeasured: '未测量',
          cacheRead: '缓存读取',
          cacheRate: '最近一次缓存命中率',
          cacheWrite: '缓存写入',
          cacheRateTip: '最近一条有输入用量的助手记录：缓存读取 ÷（非缓存输入 + 缓存读取 + 缓存写入）。不是会话或时间范围累计值。',
          incInput: '增量输入',
          output: '输出',
          totalCtx: '总上下文',
          used: '已用',
          softTip: '提醒阈值',
          midTip: '压缩阈值',
          autoCompaction: 'OpenCode 自动压缩',
          autoCompactionOff: '已关闭',
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
          limit: 'Limit',
          remaining: 'Remaining',
          baseline: 'Baseline',
          dynamic: 'Dynamic',
          dynamicTip: 'Local composition estimate: user messages, assistant messages, and tool payloads.',
          hostContextTip: 'Window usage reported by OpenChamber after the latest assistant step.',
          unmeasured: 'Unmeasured',
          cacheRead: 'Cache Read',
          cacheRate: 'Latest Cache Hit Rate',
          cacheWrite: 'Cache Write',
          cacheRateTip: 'Latest assistant record with input usage: cache read / (uncached input + cache read + cache write). Not a session or date-range aggregate.',
          incInput: 'Input',
          output: 'Output',
          totalCtx: 'Total Context',
          used: 'Used',
          softTip: 'Nudge',
          midTip: 'Compress',
          autoCompaction: 'OpenCode Auto Compaction',
          autoCompactionOff: 'Off',
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

  function readHostContext(session) {
    if (!session || !Object.hasOwn(session, 'context')) return undefined;
    const value = session.context;
    // An explicit null is authoritative after compaction or before measurement.
    if (!Number.isFinite(value?.tokens) || value.tokens < 0) return null;
    return {
      tokens: value.tokens,
      limit: Number.isFinite(value.limit) && value.limit > 0 ? value.limit : null,
    };
  }

  function updateScope(sessionId, directory) {
    if (sessionId === currentSessionId && directory === currentDirectory) return false;
    currentSessionId = sessionId;
    currentDirectory = directory;
    scopeGeneration++;
    lastInspectData = null;
    return true;
  }

  function updateSession(session, directory = currentDirectory) {
    const changedScope = updateScope(session?.id || '', directory);
    const wasAwaitingSession = awaitingDirectorySession;
    awaitingDirectorySession = false;
    hostContext = readHostContext(session);
    renderCurrent();
    if (changedScope || wasAwaitingSession || hostContext === undefined) void refresh();
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.v !== VERSION) return;

    if (data.type === 'ready') {
      if (data.payload?.theme) applyTheme(data.payload.theme);
      if (data.payload?.locale) detectLang(data.payload.locale);
      updateSession(data.payload?.session, data.payload?.directory || '');
      return;
    }
    if (data.type === 'session') {
      updateSession(data.payload?.session);
      return;
    }
    if (data.type === 'directory') {
      if (updateScope(currentSessionId, data.payload?.directory || '')) {
        // A directory event can arrive independently; wait for its session snapshot
        // rather than carrying the previous directory's reading into this view.
        awaitingDirectorySession = true;
        hostContext = undefined;
        renderCurrent();
      }
      return;
    }
    if (data.type === 'session-lifecycle') {
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

  function windowHeadline(summary, i18n) {
    const fromHost = hostContext !== undefined;
    const tokens = fromHost ? hostContext?.tokens : summary?.totalTokens;
    const limit = fromHost ? hostContext?.limit : summary?.contextLimit;
    const limitKnown = Number.isFinite(limit) && limit > 0;
    const measured = Number.isFinite(tokens);
    const usagePercent = measured && limitKnown
      ? Math.round((tokens / limit) * 1000) / 10
      : null;
    return {
      sourceTitle: fromHost ? i18n.hostContextTip : '',
      tokensShort: measured ? fmtK(tokens) : '—',
      tokensLabel: measured ? fmt(tokens) : '—',
      usageLabel: !measured ? i18n.unmeasured : usagePercent == null ? i18n.unknownWindow : `${usagePercent}%`,
      limit: limitKnown ? limit : null,
      limitLabel: limitKnown ? fmt(limit) : i18n.unknownWindow,
      remainingLabel: measured && limitKnown ? fmt(limit - tokens) : '—',
      totalBarWidth: usagePercent == null ? 0 : Math.min(100, usagePercent),
    };
  }

  function windowCard(summary, i18n, headline) {
    const { sourceTitle, tokensShort, usageLabel, limitLabel, remainingLabel } = headline;
    const composition = summary
      ? `<span class="sub num" title="${i18n.dynamicTip}">${i18n.baseline} ${fmt(summary.staticBaselineTokens || 0)} · ${i18n.dynamic} ${fmt(summary.dynamicTokens || 0)}</span>`
      : '';
    return `<div class="card" data-context-window title="${sourceTitle}">
      <div class="card-top">
        <span class="label">${i18n.ctxWindow}</span>
        <span class="sub num">${tokensShort}</span>
      </div>
      <span class="big num">${usageLabel}</span>
      <span class="sub num">${i18n.limit} ${limitLabel} · ${i18n.remaining} ${remainingLabel}</span>
      ${composition}
    </div>`;
  }

  function renderCurrent() {
    const data = lastInspectData;
    const sig = JSON.stringify({
      generation: scopeGeneration,
      locale: isZh,
      hostContext,
      sid: data?.session?.sessionId,
      title: data?.session?.title,
      sum: data?.summary,
      dcp: data?.dcp,
      act: (data?.staticInfo?.activeMcps || []).map((m) => m.id),
      dis: (data?.staticInfo?.disabledMcps || []).map((m) => m.id),
    });
    if (sig === lastPanelSig) return;
    lastPanelSig = sig;
    if (!currentSessionId) {
      root.innerHTML = '';
    } else if (data) {
      renderData(data);
    } else if (hostContext !== undefined) {
      const i18n = L();
      root.innerHTML = windowCard(null, i18n, windowHeadline(null, i18n));
    } else {
      root.innerHTML = '';
    }
  }

  function renderData(data) {
    const { session, staticInfo, summary, dcp } = data;
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
    const headline = windowHeadline(summary, i18n);
    const { tokensLabel, usageLabel, limit, limitLabel, totalBarWidth } = headline;
    const threshold = summary.nativeCompaction?.thresholdTokens;
    // The host can still be showing a step from a different model.
    const nativePct = limit != null && limit === summary.contextLimit
      && Number.isFinite(threshold) && threshold > 0 && threshold <= limit
      ? threshold / limit * 100
      : null;
    const nativeLabel = nativePct != null
      ? `${Number(nativePct.toFixed(1))}%`
      : summary.nativeCompaction?.enabled === false ? i18n.autoCompactionOff : i18n.unknownWindow;
    const nativeTick = nativePct == null ? '' :
      `<span class="ctx-tick native" style="left:${nativePct}%" title="${i18n.autoCompaction} ${nativeLabel} (${fmt(threshold)} tokens)"></span>`;
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
        ${windowCard(summary, i18n, headline)}
        <div class="card">
          <div class="card-top">
            <span class="label" title="${i18n.cacheRateTip}">${i18n.cacheRate}</span>
            <span class="sub num">${fmtK(summary.cacheRead)}</span>
          </div>
          <span class="big num">${summary.cacheHitRate == null ? '—' : `${summary.cacheHitRate}%`}</span>
          <span class="sub num">${i18n.cacheRead} ${fmt(summary.cacheRead)} · ${i18n.cacheWrite} ${fmt(summary.cacheWrite || 0)}</span>
          <span class="sub num">${i18n.incInput} ${fmt(summary.nonCachedInput)} · ${i18n.output} ${fmt(summary.outputTokens)}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-top">
          <span class="label">${i18n.totalCtx}</span>
          <span class="sub num">${tokensLabel} / ${limitLabel}</span>
        </div>
        <div class="ctx-track">
          <span class="ctx-fill" style="width:${totalBarWidth.toFixed(1)}%"></span>
          <span class="ctx-tick" style="left:${minPct}%" title="${i18n.softTip} ${minPct}%"></span>
          <span class="ctx-tick mid" style="left:${maxPct}%" title="${i18n.midTip} ${maxPct}%"></span>
          ${nativeTick}
        </div>
        <div class="card-top" style="margin-top:2px">
          <span class="sub num">${i18n.used} ${usageLabel}</span>
          <span class="sub num">DCP ${minPct}% / ${maxPct}% · ${i18n.autoCompaction} ${nativeLabel}</span>
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

  async function inspectSession(sessionId, directory, liveMcps) {
    const res = await serviceRequest('/inspect', { sessionId, directory, liveMcps, includeCompaction: true });
    if (!res || res.status !== 200 || !res.body) return null;
    return JSON.parse(res.body);
  }

  let inflight = false;
  async function refresh() {
    if (inflight || document.hidden || !currentSessionId || awaitingDirectorySession) return;
    const generation = scopeGeneration;
    const sessionId = currentSessionId;
    const directory = currentDirectory;
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

      if (generation !== scopeGeneration) return;
      const data = await inspectSession(sessionId, directory, liveMcps);
      if (generation !== scopeGeneration || !data) return;
      if (data.session?.sessionId && data.session.sessionId !== sessionId) return;
      lastInspectData = data;
      renderCurrent();
    } catch {} finally {
      inflight = false;
      if (generation !== scopeGeneration) void refresh();
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
