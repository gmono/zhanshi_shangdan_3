import { expect, it } from 'vitest';
import { initialCamera, localCamera, relativeCamera } from './initialCamera';

it('同一初始消息在不同分辨率下分别完整适配图片', () => {
  const image = { width: 1600, height: 1000 };
  const camera = initialCamera();
  const tablet = localCamera(camera, image, [1194, 834]);
  const display = localCamera(camera, image, [3840, 2160]);
  expect(camera).toEqual({ center: [0.5, 0.5], zoom: 0, space: 'image-relative' });
  expect(tablet.center).toEqual([800, -500]);
  expect(display.center).toEqual(tablet.center);
  // Zoomify 此图最高层级为 3；分辨率为 8 / 2^zoom。
  expect(1600 / (8 / 2 ** tablet.zoom)).toBeCloseTo(1194);
  expect(1000 / (8 / 2 ** display.zoom)).toBeCloseTo(2160);
});

it('拖动和放大同步相对比例，换屏幕后不复制控制端像素缩放', () => {
  const image = { width: 1600, height: 1000 };
  const relative = { center: [0.65, 0.35] as [number, number], zoom: 1.5, space: 'image-relative' as const };
  for (const size of [[1194, 834], [1920, 1080], [3840, 2160], [1024, 1366]] as [number, number][]) {
    const local = localCamera(relative, image, size);
    const roundtrip = relativeCamera(local, image, size);
    expect(roundtrip.center).toEqual(relative.center);
    expect(roundtrip.zoom).toBeCloseTo(relative.zoom);
  }
});
