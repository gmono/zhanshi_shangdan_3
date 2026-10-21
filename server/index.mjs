import { createRelay } from './relay.mjs';
const port = Number(process.env.RELAY_PORT || 8787);
const server = createRelay({ port });
server.on('listening', () => console.log(`展厅同步中继已启动，端口 ${port}`));
server.on('error', error => { console.error('中继启动失败：', error.message); process.exitCode = 1; });
