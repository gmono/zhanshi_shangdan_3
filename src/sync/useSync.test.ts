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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); FakeSocket.instances = []; });
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
