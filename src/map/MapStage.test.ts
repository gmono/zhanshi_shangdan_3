// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type View from 'ol/View';
import { initialState } from './config';
import { MapStage } from './MapStage';
import { initialCamera } from './initialCamera';

const maps = vi.hoisted(() => [] as Array<{
  target: HTMLElement | undefined;
  view: View;
  setTarget: ReturnType<typeof vi.fn>;
  updateSize: ReturnType<typeof vi.fn>;
  renderSync: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  events: Record<string, () => void>;
  attachedCameras: Array<{ center: number[] | undefined; zoom: number | undefined }>;
}>);
vi.mock('ol/Map', () => ({ default: class {
  target: HTMLElement | undefined;
  view: View;
  events: Record<string, () => void> = {};
  attachedCameras: Array<{ center: number[] | undefined; zoom: number | undefined }> = [];
  setTarget = vi.fn((target: HTMLElement | undefined) => {
    if (target) this.attachedCameras.push({ center: this.view.getCenter()?.slice(), zoom: this.view.getZoom() });
    this.target = target;
  });
  updateSize = vi.fn();
  renderSync = vi.fn();
  dispose = vi.fn();
  constructor(options: { target?: HTMLElement; view: View }) { this.target = options.target; this.view = options.view; maps.push(this); }
  on(event: string, callback: () => void) { this.events[event] = callback; }
  getSize() { return [1024, 712]; }
} }));
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); maps.length = 0; vi.unstubAllGlobals(); });
const state = { ...initialState, page: 'map-1', comparison: false };

it('未完成进场的页面不挂载地图渲染目标', () => {
  const props = { state, interactive: true, onChange: vi.fn(), pageId: 'map-1', active: false };
  render(createElement(MapStage, props));
  expect(maps).toHaveLength(1);
  expect(maps[0].target).toBeUndefined();
});

it('离场暂停渲染和发布，返回复用原地图及其缓存', () => {
  const onChange = vi.fn();
  const props = { state, interactive: true, onChange, pageId: 'map-1', active: true };
  const screen = render(createElement(MapStage, props));
  const map = maps[0];
  expect(map.target).toBeInstanceOf(HTMLElement);
  act(() => map.view.setZoom(4));
  act(() => map.events.moveend());
  expect(onChange).toHaveBeenCalled();
  onChange.mockClear();
  screen.rerender(createElement(MapStage, { ...props, active: false }));
  expect(map.target).toBeUndefined();
  act(() => map.events.moveend());
  expect(onChange).not.toHaveBeenCalled();
  screen.rerender(createElement(MapStage, props));
  expect(maps).toHaveLength(1);
  expect(map.target).toBeInstanceOf(HTMLElement);
  expect(map.dispose).not.toHaveBeenCalled();
});

it('缓存页不跟随无关相机更新，重新进入再应用该页最新状态', () => {
  const props = { state, interactive: false, onChange: vi.fn(), pageId: 'map-1', active: false };
  const screen = render(createElement(MapStage, props));
  const camera = { center: [8200, -4500] as [number, number], zoom: 4 };
  const next = { ...props, state: { ...state, mapViews: { 'map-1': camera } } };
  screen.rerender(createElement(MapStage, next));
  expect(maps[0].view.getZoom()).toBe(3);
  screen.rerender(createElement(MapStage, { ...next, active: true }));
  expect(maps[0].view.getZoom()).toBe(4);
  expect(maps).toHaveLength(1);
});

it('重新进入缓存单图时复位视角并取消离场动画，复用地图对象', () => {
  const onChange = vi.fn();
  const movedState = { ...state, mapViews: { 'map-1': { center: [8200, -4500] as [number, number], zoom: 4 } } };
  const props = { state: movedState, interactive: true, onChange, pageId: 'map-1', active: true };
  const screen = render(createElement(MapStage, props));
  const map = maps[0];
  const cancel = vi.spyOn(map.view, 'cancelAnimations');
  screen.rerender(createElement(MapStage, { ...props, active: false }));
  expect(cancel).toHaveBeenCalled();
  const resetCamera = { center: [8000, -4500] as [number, number], zoom: 0 };
  screen.rerender(createElement(MapStage, { ...props, state: { ...state, mapViews: { 'map-1': resetCamera } } }));
  expect(map.view.getCenter()).toEqual(resetCamera.center);
  expect(map.view.getZoom()).toBe(resetCamera.zoom);
  expect(map.attachedCameras.at(-1)).toEqual(resetCamera);
  expect(map.renderSync).toHaveBeenCalledTimes(2);
  expect(maps).toHaveLength(1);
  expect(map.dispose).not.toHaveBeenCalled();
});

it('展示窗口尺寸变化不能再次修正消息中的初始缩放', () => {
  const camera = { center: [8000, -4500] as [number, number], zoom: 0 };
  render(createElement(MapStage, { state: { ...state, mapViews: { 'map-1': camera } }, interactive: false, onChange: vi.fn(), pageId: 'map-1' }));
  const view = maps[0].view;
  view.setViewportSize([3840, 2160]);
  expect(view.getCenter()).toEqual(camera.center);
  expect(view.getZoom()).toBe(camera.zoom);
});

it('本机已发出的中间视角不会反向覆盖继续进行的缩放', () => {
  const onChange = vi.fn();
  const props = { state, interactive: true, onChange, pageId: 'map-1' };
  const screen = render(createElement(MapStage, props));
  const map = maps[0];
  act(() => { map.view.setZoom(4); map.events.moveend(); });
  const patch = onChange.mock.calls.at(-1)![0];
  act(() => map.view.setZoom(4.1));
  const cancel = vi.spyOn(map.view, 'cancelAnimations');
  screen.rerender(createElement(MapStage, { ...props, state: { ...state, ...patch } }));
  expect(map.view.getZoom()).toBeCloseTo(4.1);
  expect(cancel).not.toHaveBeenCalled();
});

it('母线回声的浮点末位变化不能中断正在进行的本机缩放', () => {
  const onChange = vi.fn();
  const props = { state, interactive: true, onChange, pageId: 'map-1' };
  const screen = render(createElement(MapStage, props));
  const map = maps[0];
  act(() => { map.view.setZoom(4); map.events.moveend(); });
  const patch = onChange.mock.calls.at(-1)![0];
  const echoed = { ...patch.mapViews['map-1'], zoom: 4.000000000000001 };
  act(() => map.view.setZoom(4.1));
  const cancel = vi.spyOn(map.view, 'cancelAnimations');
  screen.rerender(createElement(MapStage, { ...props, state: { ...state, mapViews: { 'map-1': echoed } } }));
  expect(map.view.getZoom()).toBeCloseTo(4.1);
  expect(cancel).not.toHaveBeenCalled();
  // 其他控制端的实际视角变化仍应正常应用。
  screen.rerender(createElement(MapStage, { ...props, state: { ...state, mapViews: { 'map-1': { ...echoed, zoom: 5 } } } }));
  expect(map.view.getZoom()).toBe(5);
  expect(cancel).toHaveBeenCalled();
});

it('相对视角在横竖屏切换时按各自画布尺寸重新适配，保持有效分辨率', () => {
  const observers: Array<() => void> = [];
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { observers.push(callback); } observe() {} disconnect() {} });
  const onChange = vi.fn();
  const camera = { ...initialCamera(), center: [0.65, 0.35] as [number, number], zoom: 1 };
  const screen = render(createElement(MapStage, { state: { ...state, mapViews: { 'map-1': camera } }, interactive: false, onChange, pageId: 'map-1' }));
  const target = screen.container.querySelector('.map-target')!;
  let size = [1194, 834];
  Object.defineProperties(target, { clientWidth: { get: () => size[0] }, clientHeight: { get: () => size[1] } });
  const view = maps[0].view;
  expect(view.isDef()).toBe(true);
  act(() => observers[0]());
  expect(view.getResolution()).toBeCloseTo(Math.max(16000 / size[0], 9000 / size[1]) / 2);
  size = [3840, 2160];
  act(() => observers[0]());
  expect(view.getResolution()).toBeCloseTo(Math.max(16000 / size[0], 9000 / size[1]) / 2);
  expect(view.getCenter()).toEqual([10400, -3150]);
  expect(onChange).not.toHaveBeenCalled();
});

const comparisonCatalog = {
  locations: [1, 2, 3].map(index => ({ id: `place-${index}`, label: ['左屏', '中屏', '右屏'][index - 1], images: [
    { url: `/zoomify/place-${index}-a/`, width: 1600, height: 1000 },
    { url: `/zoomify/place-${index}-b/`, width: 3200, height: 2000 },
  ] })),
  maps: [{ id: 'map-1', label: '图1', url: '/zoomify/map-1/', width: 1600, height: 1000 }],
};

it('主页仅发布被操作地点的相机，同地点两张不同尺寸图片一起缩放和平移', () => {
  const onChange = vi.fn();
  const home = { ...initialState, page: 'comparison', innerSplits: [[0.5], [0.5], [0.5]] };
  const props = { state: home, interactive: true, onChange, catalog: comparisonCatalog };
  const screen = render(createElement(MapStage, props));
  expect(maps).toHaveLength(6);
  const master = maps[0];
  const other = maps.slice(2).map(map => ({ center: map.view.getCenter(), zoom: map.view.getZoom() }));
  act(() => { master.view.setZoom(master.view.getZoom()! + 1); master.view.setCenter([960, -400]); master.events.moveend(); });
  expect(onChange).toHaveBeenCalledWith({ comparisonViews: { 'place-1': { center: [0.6, 0.4], zoom: 1, space: 'image-relative' } } });
  const patch = onChange.mock.calls.at(-1)![0];
  onChange.mockClear();
  screen.rerender(createElement(MapStage, { ...props, state: { ...home, ...patch } }));
  expect(maps[0].view.getCenter()).toEqual([960, -400]);
  expect(maps[1].view.getCenter()).toEqual([1920, -800]);
  expect(maps[1].view.getZoom()).toBeCloseTo(maps[0].view.getZoom()! + 1);
  expect(maps.slice(2).map(map => ({ center: map.view.getCenter(), zoom: map.view.getZoom() }))).toEqual(other);
  expect(onChange).not.toHaveBeenCalled();
  expect(maps).toHaveLength(6);
});

it('主页远端地点相机只应用于该地点且不反向广播，接收手势的底图覆盖整块区域', () => {
  const onChange = vi.fn();
  const props = { state: { ...initialState, innerSplits: [[0.5], [0.5], [0.5]] }, interactive: true, onChange, catalog: comparisonCatalog };
  const screen = render(createElement(MapStage, props));
  const camera = { center: [0.7, 0.3] as [number, number], zoom: 2, space: 'image-relative' as const };
  screen.rerender(createElement(MapStage, { ...props, state: { ...props.state, comparisonViews: { 'place-2': camera } } }));
  expect(maps[2].view.getCenter()).toEqual([1120, -300]);
  expect(maps[3].view.getCenter()).toEqual([2240, -600]);
  expect(maps[0].view.getCenter()).toEqual([800, -500]);
  expect(maps[4].view.getCenter()).toEqual([800, -500]);
  expect(screen.container.querySelectorAll('.split-inner > .map-surface')).toHaveLength(3);
  expect(onChange).not.toHaveBeenCalled();
});
