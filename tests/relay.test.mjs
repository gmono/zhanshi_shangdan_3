import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRelay } from '../server/relay.mjs';

const state = { center: [13375800, 3536000], zoom: 12, showPoints: true, comparison: true, splits: [0.3, 0.7] };
function inbox(ws) {
  const messages = [];
  const waiting = [];
  ws.on('message', raw => {
    const value = JSON.parse(raw.toString());
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
  controller.ws.send(JSON.stringify({ type: 'state', state }));
  assert.deepEqual((await display.next('snapshot')).state, state);
  await controller.next('snapshot');
  const late = await connect('display');
  assert.deepEqual((await late.next('snapshot')).state, state);
  const isolated = await connect('display', 'otherroom01');
  assert.equal((await isolated.next('snapshot')).state, null);
  display.ws.send(JSON.stringify({ type: 'state', state: { ...state, zoom: 18 } }));
  assert.equal((await display.next('error')).message, '展示端只读');
  controller.ws.send(JSON.stringify({ type: 'state', state: { ...state, splits: [0.8, 0.2] } }));
  assert.equal((await controller.next('error')).message, '无效地图状态');
  const second = await connect('controller');
  const [code] = await once(second.ws, 'close');
  assert.equal(code, 1008);
  const changed = { ...state, comparison: false, splits: [0.25, 0.75], zoom: 14 };
  controller.ws.send(JSON.stringify({ type: 'state', state: changed }));
  assert.deepEqual((await display.next('snapshot')).state, changed);
  controller.ws.close(); await once(controller.ws, 'close');
  const reconnected = await connect('controller');
  assert.deepEqual((await reconnected.next('snapshot')).state, changed);
});
