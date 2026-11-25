import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readCompressConfig(directory) {
  for (const file of ['dcp.jsonc', 'dcp.json']) {
    try {
      const raw = readFileSync(join(directory, file), 'utf8').replace(/^\uFEFF/, '');
      // Preserve quoted strings while stripping JSONC comments and trailing commas.
      const json = raw
        .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, (token) => token[0] === '"' ? token : ' ')
        .replace(/"(?:[^"\\]|\\.)*"|,(?=\s*[\]}])/g, (token) => token[0] === '"' ? token : '');
      return JSON.parse(json)?.compress;
    } catch (err) {
      if (err?.code !== 'ENOENT') return null;
    }
  }
  return null;
}

function percentage(value) {
  const number = typeof value === 'string' && /^\d+(?:\.\d+)?%$/.test(value)
    ? Number(value.slice(0, -1))
    : NaN;
  return number >= 0 && number <= 100 ? number : null;
}

const tokenLimit = (value) => Number.isFinite(value) && value >= 0 ? value : null;

export function readDcpThresholds(directory) {
  const compress = readCompressConfig(directory);
  const min = compress?.minContextLimit;
  const max = compress?.maxContextLimit;
  return {
    minPct: percentage(min),
    maxPct: percentage(max),
    minTokens: tokenLimit(min),
    maxTokens: tokenLimit(max),
  };
}
