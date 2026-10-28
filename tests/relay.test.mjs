import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRelay } from '../server/relay.mjs';

const state = { center: [13375800, 3536000], zoom: 12, showPoints: true, comparison: true, splits: [0.3, 0.7] };
function inbox(ws) {
  const messages = [];
  const waiting = [];
  let lastId = 0;
  ws.on('message', raw => {
    const value = JSON.parse(raw.toString());
    assert.ok(Number.isSafeInteger(value.id) && value.id > lastId, '所有同步消息必须有递增整数 id');
    lastId = value.id;
    const index = waiting.findIndex(item => item.type === value.type);
    if (index >= 0) { const [item] = waiting.splice(index, 1); clearTimeout(item.timer); item.resolve(value); }
    else messages.push(value);
  });
  return type => {
    const index = messages.findIndex(item => item.type === type);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const item = { type, resolve, timer: setTimeout(() => { waiting.splice(waiting.indexOf(item), 1); reject(new Error(`等待 ${type} 超时`)); }, 3000) };
      waiting.push(item);
    });
  };
}

test('房间隔离、只读权限、三图状态同步和重连快照', async t => {
  const server = createRelay({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const sockets = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); await new Promise(resolve => server.close(resolve)); });
  const connect = async (role, room = 'testroom01') => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/?role=${role}&room=${room}`);
    sockets.push(ws); const next = inbox(ws); await once(ws, 'open'); return { ws, next };
  };
  const display = await connect('display');
  assert.equal((await display.next('snapshot')).state, null);
  const controller = await connect('controller');
  await controller.next('snapshot');
  controller.ws.send(JSON.stringify({ type: 'heartbeat', id: 77 }));
  const heartbeat = await controller.next('heartbeat_ack');
  assert.equal(heartbeat.sourceId, 77);
  controller.ws.send(JSON.stringify({ type: 'state', id: 1, state }));
  const snapshot = await display.next('snapshot');
  assert.deepEqual(snapshot.state, state);
  assert.equal(snapshot.sourceId, 1);
  const late = await connect('display');
  assert.deepEqual((await late.next('snapshot')).state, state);
  const isolated = await connect('display', 'otherroom01');
  assert.equal((await isolated.next('snapshot')).state, null);
  display.ws.send(JSON.stringify({ type: 'state', state: { ...state, zoom: 18 } }));
  assert.equal((await display.next('error')).message, '展示端只读');
  controller.ws.send(JSON.stringify({ type: 'state', state: { ...state, splits: [0.8, 0.2] } }));
  assert.equal((await controller.next('error')).message, '无效地图状态');
  const changed = { ...state, comparison: false, splits: [0.25, 0.75], zoom: 14 };
  controller.ws.send(JSON.stringify({ type: 'state', state: changed }));
  assert.deepEqual((await display.next('snapshot')).state, changed);
  controller.ws.close(); await once(controller.ws, 'close');
  const reconnected = await connect('controller');
  assert.deepEqual((await reconnected.next('snapshot')).state, changed);
});

test('失联且不再回应 WebSocket Ping 的控制端释放房间并允许 iOS 重连', { timeout: 3000 }, async t => {
  const server = createRelay({ host: '127.0.0.1', port: 0, heartbeatIntervalMs: 10, heartbeatTimeoutMs: 30 });
  await once(server, 'listening');
  const sockets = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); await new Promise(resolve => server.close(resolve)); });
  const connect = async autoPong => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/?role=controller&room=iosreconnect` , { autoPong });
    sockets.push(ws);const next=inbox(ws);await once(ws,'open');return{ws,next};
  };
  const stale=await connect(false);
  assert.equal((await stale.next('snapshot')).state,null);
  await new Promise(resolve=>setTimeout(resolve,50));
  const recovered=await connect(true);
  assert.equal((await recovered.next('snapshot')).state,null);
});

test('同一房间允许多个控制端，页面局部补丁按到达顺序合并', async t => {
  const server = createRelay({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const sockets = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); await new Promise(resolve => server.close(resolve)); });
  const connect = async role => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/?role=${role}&room=multiroom01`);
    sockets.push(ws); const next = inbox(ws); await once(ws, 'open'); return { ws, next };
  };
  const first = await connect('controller');
  assert.equal((await first.next('snapshot')).state, null);
  const second = await connect('controller');
  assert.equal((await second.next('snapshot')).state, null);
  const display = await connect('display');
  assert.equal((await display.next('snapshot')).state, null);

  const seed = { center: [0, 0], zoom: 3, showPoints: false, comparison: true, page: 'comparison', outerSplits: [0.5], innerSplits: [[0.2], [0.3]], mapViews: {}, splits: [0.3, 0.7] };
  first.ws.send(JSON.stringify({ id: 1, type: 'state', pageId: 'comparison', replace: true, patch: seed }));
  assert.deepEqual((await second.next('snapshot')).state, seed);
  assert.deepEqual((await display.next('snapshot')).state, seed);

  const camera1 = { center: [0.25, 0.5], zoom: 4, space: 'image-relative' };
  first.ws.send(JSON.stringify({ id: 2, type: 'state', pageId: 'map-1', patch: { page: 'map-1', comparison: false, mapViews: { 'map-1': camera1 } } }));
  const afterFirst = (await display.next('snapshot')).state;
  assert.equal(afterFirst.page, 'map-1');
  assert.deepEqual(afterFirst.mapViews['map-1'], camera1);

  const camera2 = { center: [0.75, 0.4], zoom: 2, space: 'image-relative' };
  second.ws.send(JSON.stringify({ id: 1, type: 'state', pageId: 'map-2', patch: { page: 'map-2', comparison: false, mapViews: { 'map-2': camera2 } } }));
  const afterSecond = (await display.next('snapshot')).state;
  assert.equal(afterSecond.page, 'map-2');
  assert.deepEqual(afterSecond.mapViews, { 'map-1': camera1, 'map-2': camera2 });
  assert.deepEqual((await first.next('snapshot')).state, afterSecond);

  first.ws.send(JSON.stringify({ id: 3, type: 'state', pageId: 'comparison', patch: { page: 'comparison', comparison: true, innerSplits: { 0: [0.4] } } }));
  await display.next('snapshot');
  second.ws.send(JSON.stringify({ id: 2, type: 'state', pageId: 'comparison', patch: { page: 'comparison', comparison: true, innerSplits: { 1: [0.6] } } }));
  const final = (await display.next('snapshot')).state;
  assert.deepEqual(final.innerSplits, [[0.4], [0.6]]);
  assert.deepEqual(final.mapViews, { 'map-1': camera1, 'map-2': camera2 });
});
