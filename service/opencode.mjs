import path from 'node:path';
import { indexModelLimits, lookupModelLimits } from '../shared/model-limits.mjs';
import { readCompactionSettings, supportsCompactionBuffer } from '../shared/compaction.mjs';

const TTL_MS = 10_000;
const MAX_CACHED_SCOPES = 24;

function cacheByScope(load, now) {
  const entries = new Map();
  return (key) => {
    const current = entries.get(key);
    if (current && (current.expires == null || now() < current.expires)) return current.result;

    const entry = { expires: null };
    entries.delete(key);
    entries.set(key, entry);
    if (entries.size > MAX_CACHED_SCOPES) entries.delete(entries.keys().next().value);
    // Also cache a failure briefly; never show the previous scope or old settings on failure.
    entry.result = Promise.resolve().then(() => load(key)).catch(() => null).then((value) => {
      entry.expires = now() + TTL_MS;
      return value;
    });
    return entry.result;
  };
}

function scopedRoute(route, directory) {
  return directory ? `${route}?${new URLSearchParams({ 'location[directory]': directory })}` : route;
}

export function createOpenCodeReader(readApi, now = Date.now) {
  const info = cacheByScope(() => readApi('/api/info'), now);
  const models = cacheByScope(async (directory) => {
    const payload = await readApi(scopedRoute('/api/model', directory));
    const returned = payload?.location?.directory;
    const scopeMatches = typeof returned === 'string' && path.isAbsolute(returned)
      && Boolean(directory) && path.relative(directory, returned) === '';
    return { limits: indexModelLimits(payload), scopeMatches };
  }, now);
  const config = cacheByScope(async (directory) =>
    readCompactionSettings(await readApi(scopedRoute('/api/config', directory))), now);

  return {
    async modelLimits(directory, model) {
      const catalog = await models(directory);
      return {
        limits: lookupModelLimits(catalog?.limits, model),
        scopeMatches: catalog?.scopeMatches ?? false,
      };
    },
    async compactionSettings(directory) {
      if (!directory) return null;
      const [server, settings] = await Promise.all([info(''), config(directory)]);
      return supportsCompactionBuffer(server?.version) ? settings : null;
    },
  };
}
