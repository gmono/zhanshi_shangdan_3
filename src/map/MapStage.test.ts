// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type View from 'ol/View';
import { initialState } from './config';
import { MapStage } from './MapStage';

vi.mock('./SplitContainer', () => ({ SplitContainer: () => null }));
const maps = vi.hoisted(() => [] as Array<{
  target: HTMLElement | undefined;
  view: View;
  setTarget: ReturnType<typeof vi.fn>;
  updateSize: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  events: Record<string, () => void>;
}>);
vi.mock('ol/Map', () => ({ default: class {
  target: HTMLElement | undefined;
  view: View;
  events: Record<string, () => void> = {};
  setTarget = vi.fn((target: HTMLElement | undefined) => { this.target = target; });
  updateSize = vi.fn();
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
