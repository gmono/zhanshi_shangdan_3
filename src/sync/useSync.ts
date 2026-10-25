import { useCallback, useEffect, useRef, useState } from 'react';
import { parseState, type MapState, type Role } from './protocol.mjs';
import { initialState } from '../map/config';

export const FIXED_ROOM = 'exhibition-main-room';
export const FIXED_WS_PORT = 8787;
export const FIXED_TILE_PORT = 1421;
export interface Connection { ip: string }
export interface DiscoveredDisplay { name: string; ip: string }
const storedConnection = (role: Role): Connection => {
  if (role === 'display') return {ip:'127.0.0.1'};
  try {
    const saved = JSON.parse(localStorage.getItem('exhibition-connection-v2') || 'null');
    if (saved && typeof saved.ip === 'string') return saved;
    const legacy = JSON.parse(localStorage.getItem('exhibition-connection-v1') || 'null');
    const legacyUrl = typeof legacy?.url === 'string' ? legacy.url : '';
    return { ip: legacyUrl.replace(/^wss?:\/\//, '').replace(/:\d+$/, '') };
  } catch { return { ip: '' }; }
};
export const isIPv4 = (value: string) => /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(value);
export function useSync(role: Role) {
  const [state, setState] = useState<MapState>(() => {
    const match = typeof location !== 'undefined' ? location.pathname.match(/^\/map\/(map-[1-5])$/) : null;
    return match ? { ...initialState, page: match[1], comparison: false } : initialState;
  });
  const latest = useRef(state);
  const socket = useRef<WebSocket | null>(null);
  const [connection, setConnection] = useState<Connection>(() => storedConnection(role));
  const [status, setStatus] = useState('本地预览');
  const [peers, setPeers] = useState({ controller: false, displays: 0 });
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ready = useRef(false);
  const messageId = useRef(0);
  const send = useCallback((ws: WebSocket, message: Record<string, unknown>) => {
    ws.send(JSON.stringify({ ...message, id: ++messageId.current }));
  }, []);

  useEffect(() => {
    if (!connection.ip) { ready.current = false; setStatus('等待连接 Windows'); setPeers({ controller: false, displays: 0 }); return; }
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (!isIPv4(connection.ip)) { setError('请输入 Windows 的 IPv4 地址，例如 192.168.1.100'); setStatus('地址无效'); return; }
      const url = new URL(`ws://${connection.ip}:${FIXED_WS_PORT}`);
      url.searchParams.set('role', role); url.searchParams.set('room', FIXED_ROOM);
      setStatus('连接中'); ready.current = false;
      const ws = new WebSocket(url); socket.current = ws;
      ws.onopen = () => { if (stopped) return; send(ws, { type: 'hello', role, room: FIXED_ROOM }); setError(''); };
      ws.onmessage = event => {
        if (stopped) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'snapshot') {
          setStatus('已连接');
          const next = parseState(message.state);
          // 控制端保留正在拖动的本地状态，避免自己的回声把分割线拉回。
          if (next && role === 'display') { const received = { ...initialState, ...next }; latest.current = received; setState(received); }
          if (!ready.current && role === 'controller') send(ws, { type: 'state', state: latest.current });
          ready.current = true;
        }
        if (message.type === 'presence') setPeers({ controller: !!message.controller, displays: message.displays });
        if (message.type === 'error') setError(message.message);
      };
      ws.onerror = () => { if (!stopped) setError('无法连接同步服务，请检查地址与网络'); };
      ws.onclose = event => {
        if (stopped) return;
        ready.current = false; setPeers({ controller: false, displays: 0 });
        if (event.code === 1008) { setStatus('连接被拒绝'); setError(event.reason); return; }
        setStatus('重连中'); retry = setTimeout(connect, 2000);
      };
    };
    // 推迟到下一任务，避免 React StrictMode 的首次清理创建重复控制连接。
    const start = setTimeout(connect, 0);
    return () => { clearTimeout(start); stopped = true; ready.current = false; clearTimeout(retry); clearTimeout(timer.current); timer.current = undefined; socket.current?.close(); };
  }, [connection, role, send]);

  const update = useCallback((patch: Partial<MapState>) => {
    if (role !== 'controller') return;
    const base = latest.current;
    const next = parseState({ ...base, ...patch });
    if (!next) return;
    latest.current = next; setState(next);
    if ((patch.comparison !== undefined || patch.page !== undefined) && ready.current && socket.current?.readyState === WebSocket.OPEN) {
      send(socket.current, { type: 'state', state: next });
      return;
    }
    // 每 16ms 最多推送一次，尾帧始终推送最新状态。
    if (!timer.current) timer.current = setTimeout(() => {
      timer.current = undefined;
      if (ready.current && socket.current?.readyState === WebSocket.OPEN) send(socket.current, { type: 'state', state: latest.current });
    }, 16);
  }, [role, send]);
  const configure = (next: Connection) => {
    try { localStorage.setItem('exhibition-connection-v2', JSON.stringify(next)); } catch { /* 存储受限时仍可连接 */ }
    setError(''); setConnection(next);
  };
  return { state, update, connection, configure, status, peers, error };
}
