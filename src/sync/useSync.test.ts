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
  snapshot(state: unknown, revision = 0) { const pageId = state && typeof state === 'object' && 'page' in state && typeof state.page === 'string' ? state.page : 'comparison'; this.onmessage?.({ data: JSON.stringify({ type: 'snapshot', pageId, state, revision }) }); }
  stateAck(sourceId: number, state: unknown, revision: number) { const pageId = state && typeof state === 'object' && 'page' in state && typeof state.page === 'string' ? state.page : 'comparison'; this.onmessage?.({ data: JSON.stringify({ type: 'state_ack', pageId, state, sourceId, revision }) }); }
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); localStorage.clear(); FakeSocket.instances = []; });
async function connect(role: 'controller' | 'display') {
  vi.stubGlobal('WebSocket', FakeSocket);
  localStorage.setItem('exhibition-connection-v1', JSON.stringify({ url: 'ws://127.0.0.1:8787', room: 'testroom01' }));
  const hook = renderHook(() => useSync(role));
  await waitFor(() => expect(FakeSocket.instances.length).toBe(1));
  return { ...hook, ws: FakeSocket.instances[0] };
}
it.each(['controller', 'display'] as const)('%s 连接已有房间时采用母线状态，不发布本地旧整份状态', async role => {
  const { result, ws } = await connect(role);
  const shared = { ...initialState, page: 'map-3', comparison: false, mapViews: { 'map-3': { center: [0.2, 0.4] as [number, number], zoom: 3 } } };
  act(() => { ws.onopen?.(); ws.snapshot(shared, 7); });
  expect(result.current.state).toEqual(shared);
  expect(ws.sent.map(raw => JSON.parse(raw).type)).toEqual(['hello']);
});
it.each(['controller', 'display'] as const)('%s 在空房间通过带页面编号的完整种子建立共享状态', async role => {
  const { result, ws } = await connect(role);
  act(() => { ws.onopen?.(); ws.snapshot(null); });
  const message = JSON.parse(ws.sent.at(-1)!);
  expect(message).toMatchObject({ type: 'state', pageId: 'comparison', replace: true, patch: { page: 'comparison' } });
  expect(message.id).toBeGreaterThan(0);
  expect(result.current.state.page).toBe('comparison');
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
  expect(JSON.parse(ws.sent[0])).toMatchObject({ type: 'hello', role: 'controller', pageId: 'comparison' });
  act(() => vi.advanceTimersByTime(5000));
  expect(JSON.parse(ws.sent.at(-1)!)).toMatchObject({ type: 'heartbeat', role: 'controller', pageId: 'comparison' });
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
  act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'heartbeat_ack', sourceId: heartbeat.id, pageId: 'comparison' }) }));
  act(() => vi.advanceTimersByTime(15000));
  expect(ws.close).not.toHaveBeenCalled();
  expect(ws.sent.map(raw => JSON.parse(raw).type).filter(type => type === 'heartbeat').length).toBeGreaterThanOrEqual(2);
});
it('失联重连后采用母线快照，不把断线前缓存整份写回', async () => {
  const { result, ws } = await connect('controller');
  act(() => { ws.onopen?.(); ws.snapshot(initialState, 1); });
  act(() => result.current.update({ page: 'map-7', comparison: false }, 'map-7'));
  expect(result.current.state.page).toBe('map-7');
  vi.useFakeTimers();
  act(() => ws.onclose?.({ code: 1006, reason: 'network loss' }));
  act(() => vi.advanceTimersByTime(2000));
  expect(FakeSocket.instances).toHaveLength(2);
  const replacement = FakeSocket.instances[1];
  const shared = { ...initialState, page: 'map-3', comparison: false };
  act(() => { replacement.onopen?.(); replacement.snapshot(shared, 1); });
  expect(result.current.state.page).toBe('map-3');
  expect(replacement.sent.map(raw => JSON.parse(raw).type)).toEqual(['hello']);
});
it('展示端接收嵌套状态并在断开时保留最后画面', async () => {
  const { result, ws } = await connect('display');
  const state = { ...initialState, page: 'map-3', comparison: false };
  act(() => ws.snapshot(state, 1));
  expect(result.current.state.page).toBe('map-3');
  act(() => ws.onclose?.({ code: 1000 }));
  expect(result.current.state).toEqual(state);
});
it('Windows 触摸操作发布补丁，接收其他端状态及确认时不再次发送', async () => {
  const { result, ws } = await connect('display');
  act(() => { ws.onopen?.(); ws.snapshot(initialState, 1); });
  ws.sent = [];
  vi.useFakeTimers();
  const innerSplits = initialState.innerSplits.map((values, index) => index === 0 ? [0.4] : values);
  act(() => { result.current.update({ innerSplits }, 'comparison'); vi.advanceTimersByTime(16); });
  expect(ws.sent).toHaveLength(1);
  const write = JSON.parse(ws.sent[0]);
  expect(write).toMatchObject({ type: 'state', pageId: 'comparison', patch: { innerSplits: { 0: [0.4] } } });
  const fromIos = { ...initialState, innerSplits: initialState.innerSplits.map((values, index) => index === 1 ? [0.7] : values) };
  act(() => ws.snapshot(fromIos, 2));
  expect(result.current.state.innerSplits.slice(0, 2)).toEqual([[0.4], [0.7]]);
  const merged = { ...fromIos, innerSplits: fromIos.innerSplits.map((values, index) => index === 0 ? [0.4] : values) };
  act(() => { ws.stateAck(write.id, merged, 3); vi.advanceTimersByTime(100); });
  expect(result.current.state).toEqual(merged);
  expect(ws.sent).toHaveLength(1);
});
it.each(['controller', 'display'] as const)('%s 重连采纳共享状态，不重放断线期间的待发补丁', async role => {
  const { result, ws } = await connect(role);
  act(() => { ws.onopen?.(); ws.snapshot(initialState, 1); });
  vi.useFakeTimers();
  act(() => ws.onclose?.({ code: 1006, reason: 'network loss' }));
  act(() => result.current.update({ page: 'map-7', comparison: false }, 'map-7'));
  act(() => vi.advanceTimersByTime(2000));
  const replacement = FakeSocket.instances[1];
  const shared = { ...initialState, page: 'map-3', comparison: false };
  act(() => { replacement.onopen?.(); replacement.snapshot(shared, 5); });
  expect(result.current.state).toEqual(shared);
  expect(replacement.sent.map(raw => JSON.parse(raw).type)).toEqual(['hello']);
});
it('严格在16ms窗口合并连续更新，只发送该窗口的最新局部补丁', async () => {
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
  expect(JSON.parse(ws.sent[0])).toMatchObject({ pageId: 'comparison', patch: { center: [300, -300] } });
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
  expect(JSON.parse(ws.sent.at(-1)!).patch.center).toEqual([999, -999]);
  act(() => vi.advanceTimersByTime(1000));
  expect(ws.sent).toHaveLength(63);
});
it('换页与初始视角同条发送，先前连续更新按到达顺序先行发送', async () => {
  const { result, ws } = await connect('controller');
  act(() => { ws.onopen?.(); ws.snapshot(initialState); });
  vi.useFakeTimers();
  act(() => result.current.update({ zoom: 4 }));
  const camera = { center: [800, -500] as [number, number], zoom: 2 };
  act(() => result.current.update({ page: 'map-5', comparison: false, ...camera, mapViews: { 'map-5': camera } }, 'map-5'));
  const messages = ws.sent.map(raw => JSON.parse(raw));
  expect(messages.at(-2)).toMatchObject({ type: 'state', pageId: 'comparison', patch: { zoom: 4 } });
  expect(messages.at(-1)).toMatchObject({ type: 'state', pageId: 'map-5', patch: { page: 'map-5', mapViews: { 'map-5': camera } } });
  act(() => vi.advanceTimersByTime(16));
  expect(ws.sent).toHaveLength(messages.length);
  expect(messages.every(message => Number.isSafeInteger(message.id) && typeof message.pageId === 'string')).toBe(true);
});
it('收到其他控制端快照时保留在途本地补丁，母线确认后收敛到合并状态', async () => {
  const { result, ws } = await connect('controller');
  act(() => { ws.onopen?.(); ws.snapshot(initialState, 1); });
  const camera1 = { center: [0.2, 0.3] as [number, number], zoom: 3, space: 'image-relative' as const };
  act(() => result.current.update({ page: 'map-1', comparison: false, mapViews: { 'map-1': camera1 } }, 'map-1'));
  const write = JSON.parse(ws.sent.at(-1)!);
  const camera2 = { center: [0.7, 0.6] as [number, number], zoom: 2, space: 'image-relative' as const };
  const other = { ...initialState, page: 'map-2', comparison: false, mapViews: { 'map-2': camera2 } };
  act(() => ws.snapshot(other, 2));
  expect(result.current.state.mapViews).toEqual({ 'map-1': camera1, 'map-2': camera2 });
  const combined = { ...other, page: 'map-1', comparison: false, mapViews: { 'map-1': camera1, 'map-2': camera2 } };
  act(() => ws.stateAck(write.id, combined, 3));
  expect(result.current.state).toEqual(combined);
});

it('主页不同地点的视角在16ms内合并，远端地点更新与本地在途视角互不覆盖', async () => {
  const { result, ws } = await connect('controller');
  act(() => { ws.onopen?.(); ws.snapshot(initialState, 1); });
  ws.sent = [];
  vi.useFakeTimers();
  const first = { center: [0.3, 0.4] as [number, number], zoom: 2, space: 'image-relative' as const };
  const second = { center: [0.6, 0.7] as [number, number], zoom: 1, space: 'image-relative' as const };
  act(() => {
    result.current.update({ comparisonViews: { 'place-1': first } }, 'comparison');
    result.current.update({ comparisonViews: { 'place-2': second } }, 'comparison');
    vi.advanceTimersByTime(16);
  });
  expect(ws.sent).toHaveLength(1);
  const write = JSON.parse(ws.sent[0]);
  expect(write.patch.comparisonViews).toEqual({ 'place-1': first, 'place-2': second });
  const remote = { ...initialState, comparisonViews: { 'place-3': first } };
  act(() => ws.snapshot(remote, 2));
  expect(result.current.state.comparisonViews).toEqual({ 'place-1': first, 'place-2': second, 'place-3': first });
  act(() => ws.stateAck(write.id, { ...remote, comparisonViews: { ...remote.comparisonViews, 'place-1': first, 'place-2': second } }, 3));
  expect(result.current.state.comparisonViews).toEqual({ 'place-1': first, 'place-2': second, 'place-3': first });
});
