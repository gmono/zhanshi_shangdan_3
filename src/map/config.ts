import Projection from 'ol/proj/Projection';
import { fromLonLat } from 'ol/proj';
import type { MapState } from '../sync/protocol.mjs';

const env = import.meta.env;
const image = env.VITE_MAP_KIND !== 'xyz';
const width = Number(env.VITE_IMAGE_WIDTH || 16000);
const height = Number(env.VITE_IMAGE_HEIGHT || 9000);
if (image && (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)) {
  throw new Error('Zoomify 地图需要有效的瓦片地址和原图宽高');
}
export const mapConfig = {
  image, width, height,
  projection: image ? new Projection({ code: 'exhibition-pixels', units: 'pixels', extent: [0, -height, width, 0] }) : 'EPSG:3857',
  urls: image
    ? [env.VITE_MAP_URL || '/zoomify/scheme-1/', env.VITE_COMPARE_B_URL || '/zoomify/scheme-2/', env.VITE_COMPARE_C_URL || '/zoomify/scheme-3/']
    : [env.VITE_MAP_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', env.VITE_COMPARE_B_URL || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', env.VITE_COMPARE_C_URL || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  attribution: env.VITE_MAP_ATTRIBUTION || '© OpenStreetMap contributors · Esri',
};
export const initialState: MapState = {
  center: (image ? [width / 2, -height / 2] : fromLonLat([120.155, 30.248])) as [number, number],
  zoom: image ? 3 : 12,
  showPoints: false, page: 'comparison', comparison: true, outerSplits: [0.5], innerSplits: [[0.333, 0.667], [0.333, 0.667]], splits: [0.333, 0.667],
};
