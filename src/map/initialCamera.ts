import type { ImageResource } from './resourceCatalog';
import type { MapViewState } from '../sync/protocol.mjs';

// Zoomify 每级分辨率减半；换页前同步算好适配视角，不依赖地图挂载后的事件。
export function initialCamera(image: Pick<ImageResource, 'width' | 'height'>, size: [number, number]): MapViewState {
  const levels = Math.max(0, Math.ceil(Math.log2(Math.max(image.width, image.height) / 256)));
  const resolution = Math.max(image.width / Math.max(1, size[0]), image.height / Math.max(1, size[1]));
  return { center: [image.width / 2, -image.height / 2], zoom: Math.max(0, Math.min(levels, Math.log2(2 ** levels / resolution))) };
}
