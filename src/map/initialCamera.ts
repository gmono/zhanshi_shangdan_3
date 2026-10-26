import type { ImageResource } from './resourceCatalog';
import type { MapViewState } from '../sync/protocol.mjs';

type ImageSize = Pick<ImageResource, 'width' | 'height'>;

// 消息只携带图片内的中心比例和相对完整显示的放大级数，不携带窗口几何。
export function initialCamera(): MapViewState {
  return { center: [0.5, 0.5], zoom: 0, space: 'image-relative' };
}

export function fitZoom(image: ImageSize, size: [number, number]): number {
  const levels = Math.max(0, Math.ceil(Math.log2(Math.max(image.width, image.height) / 256)));
  const resolution = Math.max(image.width / Math.max(1, size[0]), image.height / Math.max(1, size[1]));
  return Math.log2(2 ** levels / resolution);
}

export function localCamera(camera: MapViewState, image: ImageSize, size: [number, number]): MapViewState {
  return camera.space === 'image-relative'
    ? { center: [camera.center[0] * image.width, -camera.center[1] * image.height], zoom: fitZoom(image, size) + camera.zoom }
    : camera;
}

export function relativeCamera(camera: MapViewState, image: ImageSize, size: [number, number]): MapViewState {
  return { center: [Math.max(0, Math.min(1, camera.center[0] / image.width)), Math.max(0, Math.min(1, -camera.center[1] / image.height))], zoom: Math.max(0, camera.zoom - fitZoom(image, size)), space: 'image-relative' };
}
