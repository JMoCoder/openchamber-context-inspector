// OpenChamber's input-token hit ratio, applied to the latest usage record.
export function cacheHitRate(tokens) {
  const input = tokens?.input || 0;
  const read = tokens?.cache?.read || 0;
  const write = tokens?.cache?.write || 0;
  const total = input + read + write;
  return total > 0 ? Math.round((read / total) * 1000) / 10 : null;
}
