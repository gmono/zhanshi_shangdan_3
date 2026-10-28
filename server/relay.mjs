import { WebSocketServer, WebSocket } from 'ws';
import { parseState, canPublish } from '../src/sync/protocol.mjs';

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
      rooms.set(roomId, { clients: new Set(), state: null, revision: 0, controller: null, timer: null });
    }
    const room = rooms.get(roomId);
    if (room.clients.size >= 16 || (role === 'controller' && room.controller)) {
      client.close(1008, '房间已满或已有控制端'); return;
    }
    clearTimeout(room.timer);
    room.clients.add(client);
    if (role === 'controller') room.controller = client;
    const presence = () => {
      const peers = { controller: !!room.controller, displays: [...room.clients].filter(c => c !== room.controller).length };
      for (const peer of room.clients) send(peer, { type: 'presence', ...peers });
    };
    send(client, { type: 'snapshot', state: room.state, revision: room.revision });
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
      try { message = JSON.parse(raw.toString()); } catch { send(client, { type: 'error', message: '无效消息' }); return; }
      if (message.type === 'heartbeat') {
        if (Number.isSafeInteger(message.id) && message.id > 0) send(client, { type: 'heartbeat_ack', sourceId: message.id });
        return;
      }
      if (!canPublish(role)) { send(client, { type: 'error', message: '展示端只读' }); return; }
      const state = message.type === 'state' ? parseState(message.state) : null;
      if (!state) { send(client, { type: 'error', message: '无效地图状态' }); return; }
      room.state = state;
      room.revision++;
      for (const peer of room.clients) send(peer, { type: 'snapshot', state, revision: room.revision,
        ...(Number.isSafeInteger(message.id) && message.id > 0 ? { sourceId: message.id } : {}) });
    });
    client.on('close', () => {
      clearInterval(heartbeat);
      room.clients.delete(client);
      if (room.controller === client) room.controller = null;
      presence();
      if (!room.clients.size) room.timer = setTimeout(() => rooms.delete(roomId), 60_000).unref();
    });
  });
  return wss;
}
