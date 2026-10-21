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
});
