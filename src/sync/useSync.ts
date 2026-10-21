import { useCallback, useEffect, useRef, useState } from 'react';
import { parseState, type MapState, type Role } from './protocol.mjs';
import { initialState } from '../map/config';

export interface Connection { url: string; room: string }
const storedConnection = (role: Role): Connection => {
  try {
    return JSON.parse(localStorage.getItem('exhibition-connection-v1') || 'null') || { url: role === 'display' && import.meta.env.TAURI_ENV_PLATFORM !== 'ios' ? 'ws://127.0.0.1:8787' : (import.meta.env.VITE_RELAY_URL || ''), room: import.meta.env.VITE_ROOM || 'exhibition-browser-preview' };
  } catch { return { url: '', room: '' }; }
};
export function useSync(role: Role) {
  const [state, setState] = useState<MapState>(initialState);
  const latest = useRef(state);
  const socket = useRef<WebSocket | null>(null);
  const [connection, setConnection] = useState<Connection>(() => storedConnection(role));
  const [status, setStatus] = useState('本地预览');
  const [peers, setPeers] = useState({ controller: false, displays: 0 });
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ready = useRef(false);

  useEffect(() => {
    if (!connection.url) { setStatus('本地预览'); return; }
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      let url: URL;
      try {
        url = new URL(connection.url);
        if (!['ws:', 'wss:'].includes(url.protocol) || !/^[a-zA-Z0-9_-]{8,96}$/.test(connection.room)) throw new Error();
      } catch { setError('请输入 ws:// 或 wss:// 地址，房间密钥为 8–96 位字母、数字、下划线或短横线'); setStatus('配置无效'); return; }
      url.searchParams.set('role', role); url.searchParams.set('room', connection.room);
      setStatus('连接中'); ready.current = false;
      const ws = new WebSocket(url); socket.current = ws;
      ws.onopen = () => { if (stopped) return; ws.send(JSON.stringify({ type: 'hello', role, room: connection.room })); setStatus('已连接'); setError(''); };
      ws.onmessage = event => {
        if (stopped) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'snapshot') {
          const next = parseState(message.state);
          // 控制端保留正在拖动的本地状态，避免自己的回声把分割线拉回。
          if (next && (role === 'display' || !ready.current)) { latest.current = next; setState(next); }
          if (!ready.current && !next && role === 'controller') ws.send(JSON.stringify({ type: 'state', state: latest.current }));
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
  }, [connection, role]);

  const update = useCallback((patch: Partial<MapState>) => {
    if (role !== 'controller') return;
    const base = latest.current;
    const next = parseState({ ...base, ...patch });
    if (!next) return;
    latest.current = next; setState(next);
    if (patch.comparison !== undefined && ready.current && socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: 'state', state: next }));
      return;
    }
    // 每 16ms 最多推送一次，尾帧始终推送最新状态。
    if (!timer.current) timer.current = setTimeout(() => {
      timer.current = undefined;
      if (ready.current && socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'state', state: latest.current }));
    }, 16);
  }, [role]);
  const configure = (next: Connection) => {
    try { localStorage.setItem('exhibition-connection-v1', JSON.stringify(next)); } catch { /* 存储受限时仍可连接 */ }
    setError(''); setConnection(next);
  };
  return { state, update, connection, configure, status, peers, error };
}
