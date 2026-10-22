import { describe, expect, it } from 'vitest';
import { parseState, canPublish } from './protocol.mjs';

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
  it('拒绝交叉或过近的卷帘分割线', () => {
    for (const splits of [[0.7, 0.3], [0.5, 0.51], [-1, 2], [0.3]]) {
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
