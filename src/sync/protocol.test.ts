import { describe, expect, it } from 'vitest';
import { mergeStatePatch, parseState, canPublish } from './protocol.mjs';

describe('双端同步协议', () => {
  it('接受合法相机和图层状态', () => {
    expect(parseState({ center: [120.16, 30.25], zoom: 12, showPoints: true, comparison: true, splits: [0.33, 0.67] })).toEqual({ center: [120.16, 30.25], zoom: 12, showPoints: true, comparison: true, splits: [0.33, 0.67] });
  });
  it('拒绝错误类型、无限坐标与越界缩放', () => {
    for (const value of [null, {}, { center: [Infinity, 0], zoom: 1, showPoints: true, comparison: true, splits: [0.33, 0.67] }, { center: [0, 0, 0], zoom: 1, showPoints: true, comparison: true, splits: [0.33, 0.67] }, { center: [0, 0], zoom: 99, showPoints: true, comparison: true, splits: [0.33, 0.67] }, { center: [0, 0], zoom: 1, showPoints: 'yes' }]) {
      expect(parseState(value)).toBeNull();
    }
  });
  it('只投影允许的字段，避免注入额外状态', () => {
    expect(parseState({ center: [0, 0], zoom: 3, showPoints: false, comparison: false, splits: [0.33, 0.67], role: 'controller' })).toEqual({ center: [0, 0], zoom: 3, showPoints: false, comparison: false, splits: [0.33, 0.67] });
  });
  it('拒绝交叉或越界的卷帘分割线', () => {
    for (const splits of [[0.7, 0.3], [-1, 2], [0.3]]) {
      expect(parseState({ center: [0, 0], zoom: 4, showPoints: true, comparison: true, splits })).toBeNull();
    }
  });
  it('大屏只读，未知角色也不可写', () => {
    expect(canPublish('controller')).toBe(true);
    expect(canPublish('display')).toBe(false);
    expect(canPublish('unknown')).toBe(false);
  });
  it('接受带页面和嵌套分割线的同步状态', () => {
    expect(parseState({ center: [0, 0], zoom: 3, showPoints: false, page: 'comparison', comparison: true, outerSplits: [0.5], innerSplits: [[0.33, 0.67], [0.25, 0.75]], splits: [0.33, 0.67] })).toMatchObject({ page: 'comparison', outerSplits: [0.5], innerSplits: [[0.33, 0.67], [0.25, 0.75]] });
  });
});

describe('嵌套分割协议约束', () => {
  const state = { center: [0, 0], zoom: 3, showPoints: false, page: 'comparison', comparison: true, outerSplits: [1 / 3, 2 / 3], innerSplits: [[0.5], [0.33, 0.67], []], splits: [0.33, 0.67], mapViews: { 'map-2': { center: [20, -30], zoom: 4 } } };
  it('支持每地点不同图片数量与独立地图视角', () => {
    expect(parseState(state)).toEqual(state);
  });
  it('保留相对图片视角模式，拒绝无效比例或未知坐标空间', () => {
    const camera = { center: [0.5, 0.5], zoom: 0, space: 'image-relative' };
    expect(parseState({ ...state, mapViews: { 'map-1': camera } })?.mapViews?.['map-1']).toEqual(camera);
    expect(parseState({ ...state, mapViews: { 'map-1': { ...camera, center: [1.1, 0.5] } } })).toBeNull();
    expect(parseState({ ...state, mapViews: { 'map-1': { ...camera, space: 'pixels' } } })).toBeNull();
  });
  it('完整保留两级贴边、重合和窄间距，允许面板完全收起', () => {
    for (const outerSplits of [[0, 0], [1, 1], [0, 1], [0.5, 0.51]]) {
      const collapsed = { ...state, outerSplits, innerSplits: [[0, 0], [1, 1], [0, 1]], splits: [0, 1] };
      expect(parseState(collapsed)).toEqual(collapsed);
    }
  });
  it('拒绝未知页面和地点数量不匹配', () => {
    expect(parseState({ ...state, page: '../settings' })).toBeNull();
    expect(parseState({ ...state, innerSplits: [[0.5]] })).toBeNull();
  });
  it('拒绝内层交叉、非有限分割和无效地图相机', () => {
    expect(parseState({ ...state, innerSplits: [[0.7, 0.3], [], []] })).toBeNull();
    expect(parseState({ ...state, innerSplits: [[NaN], [], []] })).toBeNull();
    expect(parseState({ ...state, mapViews: { 'map-1': { center: [Infinity, 1], zoom: 3 } } })).toBeNull();
  });
});

describe('页面局部状态补丁', () => {
  const base = { center: [0, 0], zoom: 3, showPoints: false, page: 'comparison', comparison: true, outerSplits: [1 / 3, 2 / 3], innerSplits: [[0.5], [0.33, 0.67], []], splits: [0.33, 0.67], mapViews: {} };
  it('来自不同地图页的相机补丁不会覆盖彼此的视角', () => {
    const map1 = { center: [0.2, 0.4], zoom: 2, space: 'image-relative' };
    const map2 = { center: [0.8, 0.6], zoom: 4, space: 'image-relative' };
    const afterFirst = mergeStatePatch(base, 'map-1', { page: 'map-1', comparison: false, mapViews: { 'map-1': map1 } });
    const afterSecond = mergeStatePatch(afterFirst, 'map-2', { page: 'map-2', comparison: false, mapViews: { 'map-2': map2 } });
    expect(afterSecond?.mapViews).toEqual({ 'map-1': map1, 'map-2': map2 });
    expect(afterSecond?.page).toBe('map-2');
  });
  it('比较页仅更新指定地点的内层分割线', () => {
    const first = mergeStatePatch(base, 'comparison', { innerSplits: { 0: [0.25] } });
    const second = mergeStatePatch(first, 'comparison', { innerSplits: { 2: [0.75, 0.9] } });
    expect(second?.innerSplits).toEqual([[0.25], [0.33, 0.67], [0.75, 0.9]]);
  });
  it('拒绝页面编号与补丁范围不匹配或整组旧分割线', () => {
    expect(mergeStatePatch(base, 'map-1', { page: 'map-2' })).toBeNull();
    expect(mergeStatePatch(base, 'map-1', { mapViews: { 'map-2': { center: [0.5, 0.5], zoom: 1 } } })).toBeNull();
    expect(mergeStatePatch(base, 'comparison', { innerSplits: [[0.1], [0.2], []] })).toBeNull();
  });
});
