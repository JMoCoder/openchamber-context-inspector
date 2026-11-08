/**
 * Subtitles for the context-window card.
 *
 * The card answers two pairs, matching the cache card's "A · B" lines:
 * limit · remaining, and baseline · dynamic. Remaining is null when the
 * window is unknown; callers show an em dash, never zero.
 */
export function windowCardFacts(summary) {
  const total = Number(summary?.totalTokens || 0);
  const limit = Number(summary?.contextLimit);
  const limitKnown = Number.isFinite(limit) && limit > 0;
  return {
    limitKnown,
    limit: limitKnown ? limit : null,
    remaining: limitKnown ? limit - total : null,
    baseline: Number(summary?.staticBaselineTokens || 0),
    dynamic: Number(summary?.dynamicTokens || 0),
  };
}

export function windowCardLines(summary, labels, format) {
  const facts = windowCardFacts(summary);
  const fmt = format || ((n) => Number(n || 0).toLocaleString('en-US'));
  const limitText = facts.limitKnown ? fmt(facts.limit) : labels.unknown;
  const remainingText = facts.remaining == null ? '—' : fmt(facts.remaining);
  return {
    capacity: `${labels.limit} ${limitText} · ${labels.remaining} ${remainingText}`,
    composition: `${labels.baseline} ${fmt(facts.baseline)} · ${labels.dynamic} ${fmt(facts.dynamic)}`,
  };
}
