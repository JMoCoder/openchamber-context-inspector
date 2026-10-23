(() => {
  const MAX_CONTEXT = 100_000_000;

  function positiveInt(value) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_CONTEXT) return null;
    return Math.round(n);
  }

  function modelList(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    if (Array.isArray(payload.data)) return payload.data;
    if (payload.data && Array.isArray(payload.data.models)) return payload.data.models;
    if (Array.isArray(payload.models)) return payload.models;
    return [];
  }

  function indexModelLimits(payload) {
    const limits = {};
    for (const model of modelList(payload)) {
      if (!model || typeof model !== 'object') continue;
      const providerID = String(model.providerID || '').trim();
      const id = String(model.id || model.modelID || '').trim();
      const context = positiveInt(model.limit && model.limit.context);
      if (!providerID || !id || context == null) continue;
      limits[`${providerID}/${id}`] = context;
      const modelID = String(model.modelID || '').trim();
      if (modelID && modelID !== id) limits[`${providerID}/${modelID}`] = context;
    }
    return limits;
  }

  function lookupContextLimit(limits, model) {
    if (!limits || typeof limits !== 'object' || Array.isArray(limits) || !model) return null;
    const providerID = String(model.providerID || '').trim();
    const id = String(model.id || model.modelID || '').trim();
    if (!providerID || !id) return null;
    return positiveInt(limits[`${providerID}/${id}`]);
  }

  function createCatalogCache(request, ttlMs = 10000) {
    let cached = null;
    let fetchedAt = 0;
    let inflight = null;

    async function load(force = false) {
      if (!force && cached && Date.now() - fetchedAt < ttlMs) return cached;
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          const res = await request('/api/model');
          if (!res || res.status !== 200 || !res.body) throw new Error('catalog-unavailable');
          const parsed = JSON.parse(res.body);
          const limits = indexModelLimits(parsed);
          if (Object.keys(limits).length === 0) throw new Error('catalog-empty');
          cached = limits;
          fetchedAt = Date.now();
          return cached;
        } catch (err) {
          if (cached) return cached;
          throw err;
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    }

    return { load };
  }

  const api = {
    MAX_CONTEXT,
    positiveInt,
    indexModelLimits,
    lookupContextLimit,
    createCatalogCache,
  };
  globalThis.ContextLimits = api;
})();
