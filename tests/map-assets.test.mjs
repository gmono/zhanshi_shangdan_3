import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('原图和瓦片为外置资源',async()=>{
const c=JSON.parse(await readFile('src-tauri/tauri.conf.json','utf8'));
const w=JSON.parse(await readFile('src-tauri/tauri.windows.conf.json','utf8'));
assert.equal(c.bundle.resources,undefined);
assert.deepEqual(w.bundle.resources,{'tools/vips/':'tools/vips/'});
assert.equal(w.bundle.windows.nsis.installMode,'perMachine','安装器必须提权，才能配置 iOS 连接所需的应用防火墙规则');
});
