export function parseState(value) {
  if (!value || typeof value !== 'object') return null;
  const { center, zoom, showPoints, page, comparison, splits, outerSplits, innerSplits } = value;
  if (!Array.isArray(center) || center.length !== 2 || !center.every(n => Number.isFinite(n) && Math.abs(n) <= 1e12)) return null;
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 24 || typeof showPoints !== 'boolean' || typeof comparison !== 'boolean') return null;
  const normalizedPage = typeof page === 'string' && /^[a-z0-9-]{1,32}$/.test(page) ? page : (comparison ? 'comparison' : 'map-1');
  const baseSplits = Array.isArray(outerSplits) ? outerSplits : splits;
  if (page === undefined && outerSplits === undefined && innerSplits === undefined && (!Array.isArray(splits) || splits.length !== 2)) return null;
  if (!Array.isArray(baseSplits) || baseSplits.length < 1 || !baseSplits.every(Number.isFinite) || baseSplits.some((n, i) => n < 0.05 || n > 0.95 || (i > 0 && n - baseSplits[i - 1] < 0.08))) return null;
  const nested = Array.isArray(innerSplits) ? innerSplits : [Array.isArray(splits) ? splits : [0.5]];
  if (!nested.every(list => Array.isArray(list) && list.length >= 1 && list.every(Number.isFinite) && list.every((n, i) => n >= 0.05 && n <= 0.95 && (i === 0 || n - list[i - 1] >= 0.08)))) return null;
  const result = { center: [...center], zoom, showPoints, page: normalizedPage, comparison: normalizedPage === 'comparison', outerSplits: [...baseSplits], innerSplits: nested.map(list => [...list]), splits: [...(Array.isArray(splits) ? splits : nested[0])] };
  return page === undefined && outerSplits === undefined && innerSplits === undefined ? { center: result.center, zoom, showPoints, comparison, splits: result.splits } : result;
}
export function canPublish(role) { return role === 'controller'; }
