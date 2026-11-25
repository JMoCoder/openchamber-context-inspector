import { readFileSync } from 'node:fs';
import path from 'node:path';
import { indexModelLimits, lookupModelLimits } from '../shared/model-limits.mjs';
import { readCompactionSettings, supportsCompactionBuffer } from '../shared/compaction.mjs';

const TTL_MS = 10_000;
const MAX_CACHED_SCOPES = 24;
const DESKTOP_READS = new Set(['/api/info', '/api/model', '/api/config', '/api/mcp']);
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export function createDesktopOpenCodeApi(serviceDataDir, fetchApi = fetch) {
  let port;
  // OpenChamber sets this service's data directory to <host data>/guest-data/<id>.
  // The Desktop host stores its actual API port in that same host data directory.
  if (typeof serviceDataDir === 'string' && path.isAbsolute(serviceDataDir)
      && path.basename(path.dirname(serviceDataDir)) === 'guest-data') {
    try {
      const settings = path.resolve(serviceDataDir, '..', '..', 'settings.json');
      port = JSON.parse(readFileSync(settings, 'utf8'))?.desktopLocalPort;
    } catch {}
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return async () => null;

  return async (route) => {
    if (!DESKTOP_READS.has(route.split('?', 1)[0])) return null;
    const response = await fetchApi(`http://127.0.0.1:${port}${route}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      return null;
    }
    let bytes = 0;
    const chunks = [];
    for await (const chunk of response.body ?? []) {
      bytes += chunk.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) return null;
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
}

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

function matchesDirectory(payload, directory) {
  const returned = payload?.location?.directory;
  return typeof returned === 'string' && path.isAbsolute(returned)
    && Boolean(directory) && path.relative(directory, returned) === '';
}

export function createOpenCodeReader(readApi, now = Date.now) {
  const info = cacheByScope(() => readApi('/api/info'), now);
  const models = cacheByScope(async (directory) => {
    const payload = await readApi(scopedRoute('/api/model', directory));
    return { limits: indexModelLimits(payload), scopeMatches: matchesDirectory(payload, directory) };
  }, now);
  const config = cacheByScope(async (directory) =>
    readCompactionSettings(await readApi(scopedRoute('/api/config', directory))), now);
  const mcps = cacheByScope(async (directory) => {
    const payload = await readApi(scopedRoute('/api/mcp', directory));
    if (!matchesDirectory(payload, directory) || !Array.isArray(payload?.data)) return null;
    const enabled = [];
    const disabled = [];
    for (const entry of payload.data) {
      const name = entry?.name;
      const status = entry?.status?.status;
      if (typeof name !== 'string' || !name.trim() || typeof status !== 'string' || !status.trim()) return null;
      (status === 'disabled' ? disabled : enabled).push(name);
    }
    return { enabled, disabled };
  }, now);

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
    async mcpLists(directory) {
      return path.isAbsolute(directory || '') ? mcps(directory) : null;
    },
  };
}
