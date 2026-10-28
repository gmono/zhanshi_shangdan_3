// @vitest-environment jsdom
import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSync } from './useSync';
import { initialState } from '../map/config';
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: { code: number; reason?: string }) => void;
  constructor() { FakeSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close = vi.fn((code = 1000, reason = '') => { this.readyState = 3; this.onclose?.({ code, reason }); });
  snapshot(state: unknown) { this.onmessage?.({ data: JSON.stringify({ type: 'snapshot', state }) }); }
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); FakeSocket.instances = []; });
async function connect(role: 'controller' | 'display') {
  vi.stubGlobal('WebSocket', FakeSocket);
  localStorage.setItem('exhibition-connection-v1', JSON.stringify({ url: 'ws://127.0.0.1:8787', room: 'testroom01' }));
  const hook = renderHook(() => useSync(role));
  await waitFor(() => expect(FakeSocket.instances.length).toBe(1));
  return { ...hook, ws: FakeSocket.instances[0] };
}
it('控制端连上已有房间时发布自己的当前页面，而非接管旧快照', async () => {
  const { result, ws } = await connect('controller');
  act(() => result.current.update({ page: 'map-2', comparison: false }));
  act(() => { ws.onopen?.(); ws.snapshot(initialState); });
  expect(result.current.state.page).toBe('map-2');
  expect(JSON.parse(ws.sent.at(-1)!).state.page).toBe('map-2');
});
it('直接打开第十张地图时保留路由页面状态', async () => {
  window.history.replaceState({}, '', '/map/map-10');
  const { result } = await connect('controller');
  expect(result.current.state.page).toBe('map-10');
  window.history.replaceState({}, '', '/');
});
it('同步连接心跳未应答时主动关闭旧连接以便网络恢复后重连', async () => {
  const { result, ws } = await connect('controller');
  vi.useFakeTimers();
  act(() => ws.onopen?.());
  expect(JSON.parse(ws.sent[0])).toMatchObject({ type: 'hello', role: 'controller' });
  act(() => vi.advanceTimersByTime(5000));
  expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({ type: 'heartbeat', role: 'controller' });
  const heartbeat = JSON.parse(ws.sent.at(-1)!);
  expect(Number.isSafeInteger(heartbeat.id)).toBe(true);
  act(() => vi.advanceTimersByTime(15000));
  expect(ws.close).toHaveBeenCalledWith(4000, expect.stringContaining('心跳'));
  expect(result.current.status).toBe('重连中');
});
it('收到对应心跳应答后继续保活，不误关仍连接的控制端', async () => {
  const { ws } = await connect('controller');
  vi.useFakeTimers();
  act(() => ws.onopen?.());
  act(() => vi.advanceTimersByTime(5000));
  const heartbeat = JSON.parse(ws.sent.at(-1)!);
  act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'heartbeat_ack', sourceId: heartbeat.id }) }));
  act(() => vi.advanceTimersByTime(15000));
  expect(ws.close).not.toHaveBeenCalled();
  expect(ws.sent.map(raw => JSON.parse(raw).type).filter(type => type === 'heartbeat').length).toBeGreaterThanOrEqual(2);
});
it('母线暂拒已有控制连接时保留当前状态并持续重试', async () => {
  const { result, ws } = await connect('controller');
  act(() => ws.onopen?.());
  const state = { ...initialState, page: 'map-7', comparison: false };
  act(() => result.current.update(state));
  vi.useFakeTimers();
  act(() => ws.onclose?.({ code: 1008, reason: '房间已有控制端' }));
  expect(result.current.status).toBe('等待 Windows 释放旧控制连接');
  expect(result.current.state).toEqual(state);
  act(() => vi.advanceTimersByTime(3000));
  expect(FakeSocket.instances).toHaveLength(2);
});
it('展示端接收嵌套状态并在断开时保留最后画面', async () => {
  const { result, ws } = await connect('display');
  const state = { ...initialState, page: 'map-3', comparison: false };
  act(() => ws.snapshot(state));
  expect(result.current.state.page).toBe('map-3');
  act(() => ws.onclose?.({ code: 1000 }));
  expect(result.current.state).toEqual(state);
});
it('严格在16ms窗口合并连续更新，只发送该窗口的最新状态', async () => {
  const { result, ws } = await connect('controller');
  act(() => { ws.onopen?.(); ws.snapshot(initialState); });
  ws.sent = [];
  vi.useFakeTimers();
  act(() => {
    result.current.update({ center: [100, -100] });
    result.current.update({ center: [200, -200] });
    vi.advanceTimersByTime(10);
    result.current.update({ center: [300, -300] });
    vi.advanceTimersByTime(5);
  });
  expect(ws.sent).toHaveLength(0);
  act(() => vi.advanceTimersByTime(1));
  expect(ws.sent).toHaveLength(1);
  expect(JSON.parse(ws.sent[0]).state.center).toEqual([300, -300]);
});
it('每秒1000次操作合并为至少60次状态发送，停止后补发最后状态', async () => {
  const { result, ws } = await connect('controller');
  act(() => { ws.onopen?.(); ws.snapshot(initialState); });
  ws.sent = [];
  vi.useFakeTimers();
  for (let millisecond = 0; millisecond < 1000; millisecond++) {
    act(() => {
      result.current.update({ center: [millisecond, -millisecond] });
      vi.advanceTimersByTime(1);
    });
  }
  expect(ws.sent).toHaveLength(62);
  act(() => vi.advanceTimersByTime(8));
  expect(ws.sent).toHaveLength(63);
  expect(JSON.parse(ws.sent.at(-1)!).state.center).toEqual([999, -999]);
  act(() => vi.advanceTimersByTime(1000));
  expect(ws.sent).toHaveLength(63);
});
it('切换页面立即同步，不等待16ms合并窗口', async () => {
  const { result, ws } = await connect('controller');
  act(() => { ws.onopen?.(); ws.snapshot(initialState); });
  ws.sent = [];
  vi.useFakeTimers();
  act(() => result.current.update({ page: 'map-5', comparison: false }));
  expect(ws.sent).toHaveLength(1);
  expect(JSON.parse(ws.sent[0]).state.page).toBe('map-5');
});

it('换页和初始视角在同一消息发送，待发尾帧不回写旧状态，所有消息包含递增整数编号', async () => {
  const { result, ws } = await connect('controller');
  act(() => { ws.onopen?.(); ws.snapshot(initialState); });
  vi.useFakeTimers();
  act(() => result.current.update({ zoom: 4 }));
  const camera = { center: [800, -500] as [number, number], zoom: 2 };
  const start = ws.sent.length;
  act(() => result.current.update({ page: 'map-5', comparison: false, ...camera, mapViews: { 'map-5': camera } }));
  expect(ws.sent.length).toBe(start + 1);
  act(() => vi.advanceTimersByTime(16));
  for (const message of ws.sent.slice(start).map(raw => JSON.parse(raw))) {
    expect(message.state.page).toBe('map-5');
    expect(message.state.mapViews['map-5']).toEqual(camera);
    expect(message.state.zoom).toBe(2);
  }
  const ids = ws.sent.map(raw => JSON.parse(raw).id);
  expect(ids.every((id, i) => Number.isSafeInteger(id) && id > (ids[i - 1] || 0))).toBe(true);
});
