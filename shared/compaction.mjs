const BUFFER_PERCENT = /^([1-9]\d?(\.\d+)?)%$/u;
const RESERVE_SHARE = 0.15;
const RESERVE_MIN = 16_000;

export function supportsCompactionBuffer(version) {
  const match = /^2\.(\d+)\.\d+(?:[+-][\w.+-]+)?$/.exec(version);
  return match != null && Number(match[1]) >= 3;
}

const isRecord = (value) => value != null && typeof value === 'object' && !Array.isArray(value);

// OpenCode /api/config yields documents in precedence order. Each supplied
// field overrides just itself; keep.tokens and background do not set the line.
export function readCompactionSettings(entries) {
  if (!Array.isArray(entries)) return null;
  const settings = { auto: true };
  for (const entry of entries) {
    if (entry?.type === 'directory') continue;
    if (entry?.type !== 'document' || !isRecord(entry.info)) return null;
    const config = entry.info.compaction;
    if (config === undefined) continue;
    if (!isRecord(config)) return null;
    if (config.auto !== undefined) {
      if (typeof config.auto !== 'boolean') return null;
      settings.auto = config.auto;
    }
    if (config.buffer !== undefined) {
      const value = config.buffer;
      if (!(typeof value === 'string' && BUFFER_PERCENT.test(value)) &&
          !(Number.isSafeInteger(value) && value >= 0)) return null;
      settings.buffer = value;
    }
  }
  return settings;
}

export function autoCompaction(settings, limits) {
  if (!settings) return null;
  if (!settings.auto) return { enabled: false };
  const { input, context } = limits ?? {};
  const window = input && context ? Math.min(input, context) : input || context;
  if (!(window > 0)) return null;

  // Mirrors calculateCeiling in OpenCode v2.3's session/compaction.ts.
  const buffer = typeof settings.buffer === 'string'
    ? Math.round(window * Number.parseFloat(settings.buffer) / 100)
    : settings.buffer;
  const reserve = buffer !== undefined && buffer < window
    ? buffer
    : Math.max(Math.floor(window * RESERVE_SHARE), window >= 2 * RESERVE_MIN ? RESERVE_MIN : 0);
  return { enabled: true, thresholdTokens: window - reserve };
}
