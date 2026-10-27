export interface ImageResource { url: string; width: number; height: number; year?: string }
export interface ResourceCatalog {
  locations: { id: string; label: string; images: ImageResource[] }[];
  maps: (ImageResource & { id: string; label: string })[];
}
export function parseCatalog(value: unknown): ResourceCatalog | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as ResourceCatalog;
  const image = (v: ImageResource) => v && typeof v.url === 'string' && /^\/zoomify\/[a-z0-9-]+\/$/.test(v.url) && Number.isInteger(v.width) && Number.isInteger(v.height) && v.width > 0 && v.height > 0 && v.width <= 1000000 && v.height <= 1000000;
  if (!Array.isArray(c.locations) || c.locations.length !== 3 || !Array.isArray(c.maps) || c.maps.length < 1 || c.maps.length > 10) return null;
  if (!c.locations.every((p, i) => p && p.id === `place-${i + 1}` && ['左屏', '中屏', '右屏'][i] === p.label && Array.isArray(p.images) && p.images.length === 2 && p.images.every(image))) return null;
  if (!c.maps.every((v, i) => image(v) && v.id === `map-${i + 1}` && typeof v.label === 'string')) return null;
  return c;
}
