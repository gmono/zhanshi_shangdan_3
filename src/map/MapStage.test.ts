// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type View from 'ol/View';
import { initialState } from './config';
import { MapStage } from './MapStage';
import { initialCamera } from './initialCamera';

vi.mock('./SplitContainer', () => ({ SplitContainer: () => null }));
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
