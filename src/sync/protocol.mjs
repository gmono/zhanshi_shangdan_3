export function parseState(value) {
  if (!value || typeof value !== 'object') return null;
  const { center, zoom, showPoints, comparison, splits } = value;
  if (!Array.isArray(center) || center.length !== 2 || !center.every(n => Number.isFinite(n) && Math.abs(n) <= 1e12)) return null;
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 24 || typeof showPoints !== 'boolean' || typeof comparison !== 'boolean') return null;
  if (!Array.isArray(splits) || splits.length !== 2 || !splits.every(Number.isFinite) || splits[0] < 0.05 || splits[1] > 0.95 || splits[1] - splits[0] < 0.08) return null;
  return { center: [...center], zoom, showPoints, comparison, splits: [...splits] };
}
export function canPublish(role) { return role === 'controller'; }
