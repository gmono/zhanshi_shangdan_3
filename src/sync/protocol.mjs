const cameraValid = value => value && Array.isArray(value.center) && value.center.length === 2 && value.center.every(n => Number.isFinite(n) && Math.abs(n) <= 1e12) && Number.isFinite(value.zoom) && value.zoom >= 0 && value.zoom <= 24;
const splitsValid = values => Array.isArray(values) && values.length <= 10 && values.every((n, i) => Number.isFinite(n) && n >= 0 && n <= 1 && (i === 0 || n >= values[i - 1]));
export function parseState(value) {
  if (!cameraValid(value) || typeof value.showPoints !== 'boolean' || typeof value.comparison !== 'boolean') return null;
  const { center, zoom, showPoints, comparison, splits, page, outerSplits, innerSplits, mapViews } = value;
  const legacy = page === undefined && outerSplits === undefined && innerSplits === undefined;
  if (legacy) {
    if (!splitsValid(splits) || splits.length !== 2) return null;
    return { center: [...center], zoom, showPoints, comparison, splits: [...splits] };
  }
  if (typeof page !== 'string' || !/^(comparison|map-[1-9][0-9]?)$/.test(page)) return null;
  if (!splitsValid(outerSplits) || !Array.isArray(innerSplits) || innerSplits.length !== outerSplits.length + 1 || !innerSplits.every(splitsValid)) return null;
  if (!splitsValid(splits) || splits.length !== 2) return null;
  const cameras = {};
  if (mapViews !== undefined) {
    if (!mapViews || typeof mapViews !== 'object' || Array.isArray(mapViews) || Object.keys(mapViews).length > 32) return null;
    for (const [key, camera] of Object.entries(mapViews)) {
      if (!/^map-[1-9][0-9]?$/.test(key) || !cameraValid(camera)) return null;
      cameras[key] = { center: [...camera.center], zoom: camera.zoom };
    }
  }
  return { center: [...center], zoom, showPoints, comparison: page === 'comparison', page, outerSplits: [...outerSplits], innerSplits: innerSplits.map(list => [...list]), splits: [...splits], ...(mapViews !== undefined ? { mapViews: cameras } : {}) };
}
export function canPublish(role) { return role === 'controller'; }
