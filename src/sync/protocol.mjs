const cameraValid = value => value && Array.isArray(value.center) && value.center.length === 2 && value.center.every(n => Number.isFinite(n) && Math.abs(n) <= 1e12) && Number.isFinite(value.zoom) && value.zoom >= 0 && value.zoom <= 24;
const splitsValid = values => Array.isArray(values) && values.every((n, i) => Number.isFinite(n) && n >= 0 && n <= 1 && (i === 0 || n >= values[i - 1]));
const pageValid = value => typeof value === 'string' && /^(comparison|map-[1-9][0-9]?)$/.test(value);
export function parseState(value) {
  if (!cameraValid(value) || typeof value.showPoints !== 'boolean' || typeof value.comparison !== 'boolean') return null;
  const { center, zoom, showPoints, comparison, splits, page, outerSplits, innerSplits, mapViews, comparisonViews } = value;
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
      if (camera.space !== undefined && (camera.space !== 'image-relative' || camera.center.some(n => n < 0 || n > 1))) return null;
      cameras[key] = { center: [...camera.center], zoom: camera.zoom, ...(camera.space ? { space: camera.space } : {}) };
    }
  }
  const placeCameras = {};
  if (comparisonViews !== undefined) {
    if (!comparisonViews || typeof comparisonViews !== 'object' || Array.isArray(comparisonViews) || Object.keys(comparisonViews).length > innerSplits.length) return null;
    for (const [key, camera] of Object.entries(comparisonViews)) {
      if (!/^place-[1-9][0-9]?$/.test(key) || Number(key.slice(6)) > innerSplits.length || !cameraValid(camera) || camera.space !== 'image-relative' || camera.center.some(n => n < 0 || n > 1)) return null;
      placeCameras[key] = { center: [...camera.center], zoom: camera.zoom, space: 'image-relative' };
    }
  }
  return { center: [...center], zoom, showPoints, comparison: page === 'comparison', page, outerSplits: [...outerSplits], innerSplits: innerSplits.map(list => [...list]), splits: [...splits], ...(mapViews !== undefined ? { mapViews: cameras } : {}), ...(comparisonViews !== undefined ? { comparisonViews: placeCameras } : {}) };
}
export function canPublish(role) { return role === 'controller' || role === 'display'; }

export function mergeStatePatch(base, pageId, patch, replace = false) {
  if (!pageValid(pageId) || !patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const fields = ['center', 'zoom', 'showPoints', 'comparison', 'page', 'outerSplits', 'innerSplits', 'mapViews', 'comparisonViews', 'splits'];
  if (Object.keys(patch).some(key => !fields.includes(key))) return null;
  if (patch.page !== undefined && patch.page !== pageId) return null;
  if (replace) return parseState(patch);
  const previous = parseState(base);
  if (!previous) return null;

  const next = { ...previous };
  for (const key of fields) {
    if (key !== 'innerSplits' && key !== 'mapViews' && key !== 'comparisonViews' && patch[key] !== undefined) next[key] = patch[key];
  }

  if (patch.mapViews !== undefined) {
    if (pageId === 'comparison' || !patch.mapViews || typeof patch.mapViews !== 'object' || Array.isArray(patch.mapViews)) return null;
    if (Object.keys(patch.mapViews).some(key => key !== pageId)) return null;
    next.mapViews = { ...previous.mapViews, ...patch.mapViews };
  }

  if (patch.comparisonViews !== undefined) {
    if (pageId !== 'comparison' || !patch.comparisonViews || typeof patch.comparisonViews !== 'object' || Array.isArray(patch.comparisonViews)) return null;
    next.comparisonViews = { ...previous.comparisonViews, ...patch.comparisonViews };
  }

  if (patch.innerSplits !== undefined) {
    if (pageId !== 'comparison' || !patch.innerSplits || typeof patch.innerSplits !== 'object' || Array.isArray(patch.innerSplits)) return null;
    const innerSplits = previous.innerSplits.map(values => [...values]);
    for (const [indexText, values] of Object.entries(patch.innerSplits)) {
      if (!/^(0|[1-9][0-9]*)$/.test(indexText)) return null;
      const index = Number(indexText);
      if (!Number.isSafeInteger(index) || index >= innerSplits.length) return null;
      innerSplits[index] = values;
    }
    next.innerSplits = innerSplits;
  }

  return parseState(next);
}
