import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeStatePatch, parseState, type MapState, type Role } from './protocol.mjs';
import { initialState } from '../map/config';

export const FIXED_ROOM = 'exhibition-main-room';
export const FIXED_WS_PORT = 8787;
export const FIXED_TILE_PORT = 1421;
const HEARTBEAT_INTERVAL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 15000;
export interface Connection { ip: string }
export interface DiscoveredDisplay { name: string; ip: string }
export type StatePatch = Omit<Partial<MapState>, 'innerSplits'> & { innerSplits?: number[][] | Record<string, number[]> };
export interface UpdateOptions { replace?: boolean; activate?: boolean }
interface PendingUpdate { pageId: string; patch: Record<string, unknown>; replace: boolean }
interface SentUpdate extends PendingUpdate { id: number }
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

function combinePatches(first: Record<string, unknown>, second: Record<string, unknown>) {
  const combined = { ...first, ...second };
  for (const key of ['mapViews', 'innerSplits']) {
    const a = first[key], b = second[key];
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      combined[key] = { ...a, ...b };
    }
  }
  return combined;
}

function replayUpdates(base: MapState, updates: PendingUpdate[]) {
  return updates.reduce((state, update) => mergeStatePatch(state, update.pageId, update.patch, update.replace) || state, base);
}

function normalizeState(value: unknown): MapState | null {
  const parsed = parseState(value);
  if (!parsed) return null;
  return { ...initialState, ...parsed, mapViews: parsed.mapViews || initialState.mapViews } as MapState;
}

export function useSync(role: Role) {
  const [state, setState] = useState<MapState>(() => {
    const match = typeof location !== 'undefined' ? location.pathname.match(/^\/map\/(map-(?:[1-9]|10))$/) : null;
    return match ? { ...initialState, page: match[1], comparison: false } : initialState;
  });
  const latest = useRef(state);
  const socket = useRef<WebSocket | null>(null);
  const pending = useRef<PendingUpdate | null>(null);
  const inFlight = useRef<SentUpdate[]>([]);
  const revision = useRef(0);
  const [connection, setConnection] = useState<Connection>(() => storedConnection(role));
  const [status, setStatus] = useState('本地预览');
  const [peers, setPeers] = useState({ controller: false, controllers: 0, displays: 0 });
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ready = useRef(false);
  const messageId = useRef(0);
  const send = useCallback((ws: WebSocket, message: Record<string, unknown>) => {
    const id = ++messageId.current;
    ws.send(JSON.stringify({ ...message, id }));
    return id;
  }, []);
  const sendState = useCallback((ws: WebSocket, update: PendingUpdate) => {
    const id = send(ws, { type: 'state', pageId: update.pageId, patch: update.patch, ...(update.replace ? { replace: true } : {}) });
    inFlight.current.push({ ...update, id });
    return id;
  }, [send]);
  const flushPending = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const update = pending.current;
    if (!update || !ready.current || socket.current?.readyState !== WebSocket.OPEN) return;
    pending.current = null;
    sendState(socket.current, update);
  }, [sendState]);

  useEffect(() => {
    if (!connection.ip) { ready.current = false; setStatus('等待连接 Windows'); setPeers({ controller: false, controllers: 0, displays: 0 }); return; }
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;
    let awaitingHeartbeat: number | undefined;
    const connect = () => {
      if (!isIPv4(connection.ip)) { setError('请输入 Windows 的 IPv4 地址，例如 192.168.1.100'); setStatus('地址无效'); return; }
      const url = new URL(`ws://${connection.ip}:${FIXED_WS_PORT}`);
      url.searchParams.set('role', role); url.searchParams.set('room', FIXED_ROOM);
      setStatus('连接中'); ready.current = false;
      const ws = new WebSocket(url); socket.current = ws;
      ws.onopen = () => {
        if (stopped) return;
        revision.current = 0;
        send(ws, { type: 'hello', role, room: FIXED_ROOM, pageId: latest.current.page }); setError('');
        heartbeat = setInterval(() => {
          if (stopped || awaitingHeartbeat !== undefined || ws.readyState !== WebSocket.OPEN) return;
          const id = send(ws, { type: 'heartbeat', role, room: FIXED_ROOM, pageId: latest.current.page });
          awaitingHeartbeat = id;
          heartbeatTimeout = setTimeout(() => {
            if (stopped || awaitingHeartbeat !== id) return;
            setError('同步心跳超时，正在重新连接 Windows');
            ws.close(4000, '同步心跳超时');
          }, HEARTBEAT_TIMEOUT_MS);
        }, HEARTBEAT_INTERVAL_MS);
      };
      ws.onmessage = event => {
        if (stopped) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'heartbeat_ack') {
          if (message.sourceId === awaitingHeartbeat) {
            awaitingHeartbeat = undefined;
            clearTimeout(heartbeatTimeout);
            heartbeatTimeout = undefined;
          }
          return;
        }
        if (message.type === 'state_ack') {
          const canonical = normalizeState(message.state);
          if (!canonical) return;
          const incomingRevision = Number(message.revision);
          if (Number.isSafeInteger(incomingRevision) && incomingRevision >= revision.current) revision.current = incomingRevision;
          const acknowledgement = inFlight.current.findIndex(item => item.id === message.sourceId);
          if (acknowledgement >= 0) inFlight.current = inFlight.current.slice(acknowledgement + 1);
          const queued = [...inFlight.current, ...(pending.current ? [pending.current] : [])];
          const next = role === 'controller' ? replayUpdates(canonical, queued) : canonical;
          latest.current = next; setState(next);
          return;
        }
        if (message.type === 'snapshot') {
          setStatus('已连接');
          const incomingRevision = Number(message.revision);
          if (Number.isSafeInteger(incomingRevision) && incomingRevision < revision.current) return;
          if (Number.isSafeInteger(incomingRevision)) revision.current = incomingRevision;
          const wasReady = ready.current;
          const parsed = parseState(message.state);
          const received = normalizeState(message.state);
          if (received) {
            let next = received;
            const queued = pending.current;
            if (role === 'controller') next = replayUpdates(received, [...inFlight.current, ...(queued ? [queued] : [])]);
            latest.current = next; setState(next);
            if (!wasReady && role === 'controller' && parsed && !Object.prototype.hasOwnProperty.call(parsed, 'page')) {
              pending.current = { pageId: initialState.page, patch: initialState as unknown as Record<string, unknown>, replace: true };
            }
          } else if (!wasReady && role === 'controller') {
            pending.current = { pageId: latest.current.page, patch: latest.current as unknown as Record<string, unknown>, replace: true };
          }
          ready.current = true;
          if (role === 'controller') flushPending();
        }
        if (message.type === 'presence') setPeers({ controller: !!message.controller, controllers: Number(message.controllers) || Number(!!message.controller), displays: Number(message.displays) || 0 });
        if (message.type === 'error') setError(message.message);
      };
      ws.onerror = () => { if (!stopped) setError('无法连接同步服务，请检查地址与网络'); };
      ws.onclose = event => {
        if (stopped) return;
        clearInterval(heartbeat); heartbeat = undefined;
        clearTimeout(heartbeatTimeout); heartbeatTimeout = undefined; awaitingHeartbeat = undefined;
        inFlight.current = []; revision.current = 0;
        ready.current = false; setPeers({ controller: false, controllers: 0, displays: 0 });
        if (event.code === 1008 && event.reason.includes('房间已有控制端')) {
          setStatus('等待 Windows 释放旧控制连接');
          setError('Windows 仍检测到上次的 iOS 连接，将继续重试恢复同步。');
          retry = setTimeout(connect, 3000);
          return;
        }
        if (event.code === 1008) { setStatus('连接被拒绝'); setError(event.reason); return; }
        setStatus('重连中'); retry = setTimeout(connect, 2000);
      };
    };
    const start = setTimeout(connect, 0);
    return () => { clearTimeout(start); stopped = true; ready.current = false; clearTimeout(retry); clearInterval(heartbeat); clearTimeout(heartbeatTimeout); clearTimeout(timer.current); timer.current = undefined; socket.current?.close(); };
  }, [connection, role, send, flushPending]);

  const update = useCallback((patch: StatePatch, pageId?: string, options: UpdateOptions = {}) => {
    if (role !== 'controller') return;
    const base = latest.current;
    const replace = options.replace === true;
    const activate = options.activate !== false;
    const targetPage = typeof patch.page === 'string' ? patch.page : pageId || base.page;
    const wirePatch: Record<string, unknown> = { ...patch };
    if (!replace && Array.isArray(wirePatch.innerSplits)) {
      const changed: Record<string, number[]> = {};
      (wirePatch.innerSplits as number[][]).forEach((values, index) => {
        if (JSON.stringify(values) !== JSON.stringify(base.innerSplits?.[index])) changed[String(index)] = values;
      });
      wirePatch.innerSplits = changed;
    }
    if (!replace && wirePatch.mapViews && typeof wirePatch.mapViews === 'object') {
      const view = (wirePatch.mapViews as Record<string, unknown>)[targetPage];
      wirePatch.mapViews = view ? { [targetPage]: view } : {};
    }
    const pageChanged = activate && targetPage !== base.page;
    if (!replace && (pageChanged || patch.page !== undefined)) {
      wirePatch.page = targetPage;
      wirePatch.comparison = targetPage === 'comparison';
    }
    const next = mergeStatePatch(base, targetPage, wirePatch, replace);
    if (!next) return;
    latest.current = next; setState(next);

    const urgent = replace || patch.page !== undefined || pageChanged;
    if (urgent) {
      flushPending();
      if (ready.current && socket.current?.readyState === WebSocket.OPEN) {
        sendState(socket.current, { pageId: targetPage, patch: wirePatch, replace });
      } else {
        pending.current = { pageId: targetPage, patch: wirePatch, replace };
      }
      return;
    }

    if (pending.current && pending.current.pageId !== targetPage) flushPending();
    if (pending.current?.pageId === targetPage) {
      pending.current = { ...pending.current, patch: combinePatches(pending.current.patch, wirePatch) };
    } else {
      pending.current = { pageId: targetPage, patch: wirePatch, replace };
    }
    if (ready.current && !timer.current) timer.current = setTimeout(flushPending, 16);
  }, [role, sendState, flushPending]);

  const configure = (next: Connection) => {
    try { localStorage.setItem('exhibition-connection-v2', JSON.stringify(next)); } catch { /* 存储受限时仍可连接 */ }
    setError(''); setConnection(next);
  };
  return { state, update, connection, configure, status, peers, error };
}
