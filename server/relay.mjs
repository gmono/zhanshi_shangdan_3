import { WebSocketServer, WebSocket } from 'ws';
import { mergeStatePatch, parseState, canPublish } from '../src/sync/protocol.mjs';

export function createRelay({ port = 8787, host = '0.0.0.0', heartbeatIntervalMs = 5000, heartbeatTimeoutMs = 15000 } = {}) {
  const rooms = new Map();
  const wss = new WebSocketServer({ port, host, maxPayload: 4096 });
  let messageId = 0;
  const send = (client, value) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ ...value, id: ++messageId }));
  };
  wss.on('connection', (client, request) => {
    const url = new URL(request.url, 'http://relay.local');
    const roomId = url.searchParams.get('room') || '';
    const role = url.searchParams.get('role');
    if (!/^[a-zA-Z0-9_-]{8,96}$/.test(roomId) || !['controller', 'display'].includes(role)) {
      client.close(1008, '无效的房间或角色'); return;
    }
    if (!rooms.has(roomId)) {
      if (rooms.size >= 100) { client.close(1013, '房间已满'); return; }
      rooms.set(roomId, { clients: new Set(), roles: new Map(), state: null, revision: 0, timer: null });
    }
    const room = rooms.get(roomId);
    if (room.clients.size >= 16) {
      client.close(1008, '房间已满'); return;
    }
    clearTimeout(room.timer);
    room.clients.add(client);
    room.roles.set(client, role);
    const presence = () => {
      const controllers = [...room.roles.values()].filter(peerRole => peerRole === 'controller').length;
      const peers = { controller: controllers > 0, controllers, displays: [...room.roles.values()].filter(peerRole => peerRole === 'display').length, pageId: room.state?.page || 'comparison' };
      for (const peer of room.clients) send(peer, { type: 'presence', ...peers });
    };
    send(client, { type: 'snapshot', pageId: room.state?.page || 'comparison', state: room.state, revision: room.revision });
    presence();
    client.on('error', () => {});
    let lastPongAt = Date.now();
    const heartbeat = setInterval(() => {
      if (client.readyState !== WebSocket.OPEN) { clearInterval(heartbeat); return; }
      if (Date.now() - lastPongAt >= heartbeatTimeoutMs) { client.terminate(); return; }
      client.ping();
    }, heartbeatIntervalMs);
    client.on('pong', () => { lastPongAt = Date.now(); });
    client.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { send(client, { type: 'error', pageId: room.state?.page || 'comparison', message: '无效消息' }); return; }
      if (message.type === 'heartbeat') {
        if (Number.isSafeInteger(message.id) && message.id > 0) send(client, { type: 'heartbeat_ack', pageId: room.state?.page || message.pageId || 'comparison', sourceId: message.id });
        return;
      }
      if (!canPublish(role)) { send(client, { type: 'error', pageId: message.pageId || room.state?.page || 'comparison', message: '展示端只读' }); return; }
      if (message.type !== 'state') return;
      const pageId = message.pageId || message.state?.page || 'comparison';
      const patch = message.patch ?? message.state;
      const state = message.replace === true || message.state !== undefined
        ? (parseState(patch) ? mergeStatePatch(room.state, pageId, patch, true) : null)
        : mergeStatePatch(room.state, pageId, patch);
      if (!state) { send(client, { type: 'error', pageId, message: message.state !== undefined ? '无效地图状态' : '无效地图状态补丁或页面编号' }); return; }
      room.state = state;
      room.revision++;
      for (const peer of room.clients) if (peer !== client) send(peer, { type: 'snapshot', pageId: state.page || pageId, state, revision: room.revision,
        ...(Number.isSafeInteger(message.id) && message.id > 0 ? { sourceId: message.id } : {}) });
      send(client, { type: 'state_ack', pageId: state.page || pageId, state, revision: room.revision,
        ...(Number.isSafeInteger(message.id) && message.id > 0 ? { sourceId: message.id } : {}) });
    });
    client.on('close', () => {
      clearInterval(heartbeat);
      room.clients.delete(client);
      room.roles.delete(client);
      presence();
      if (!room.clients.size) room.timer = setTimeout(() => rooms.delete(roomId), 60_000).unref();
    });
  });
  return wss;
}
