import { stat, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
async function walk(dir) { let total=0;for(const e of await readdir(dir,{withFileTypes:true})){const p=`${dir}/${e.name}`;total+=e.isDirectory()?await walk(p):(await stat(p)).size;}return total;}
await assert.rejects(stat('dist/zoomify'));
const bytes=await walk('dist');assert.ok(bytes<15*1024*1024, `前端包异常增大：${bytes}`);
console.log(`前端资源 ${bytes} 字节，完整地图未嵌入。`);
