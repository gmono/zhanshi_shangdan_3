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
  onclose?: (event: { code: number }) => void;
  constructor() { FakeSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
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
