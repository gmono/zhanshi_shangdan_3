// 直接验证生产 Rust 处理服务：缺文件、处理器故障、损坏原图、恢复、连续进度。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createOriginals} from './create-e2e-originals.mjs';
const base=resolve('tmp/resource-progress-check');await mkdir(base,{recursive:true});
const root=await mkdtemp(join(base,'originals-'));const events=[];let child;
const binary=process.env.E2E_NATIVE_BINARY;if(!binary)throw Error('缺少 E2E_NATIVE_BINARY');
const vips=process.env.VIPS_BIN||'vips';
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
function start(processor){child=spawn(resolve(binary),[root,processor,'127.0.0.1:1437','8797'],{stdio:'inherit'});}
async function stop(){if(child&&child.exitCode===null)await new Promise(ok=>{child.once('exit',ok);child.kill()});}
async function poll(test){for(let i=0;i<600;i++){
  try{const r=await fetch('http://127.0.0.1:1437/progress');const p=await r.json();events.push(p);if(test(p))return p;}catch{}
  await delay(100);
}throw Error('处理进度未达到预期状态');}
const report={checks:{}};
try{
  start(vips);
  const missing=await poll(p=>p.phase==='error');assert.match(missing.error,/缺少原始图片/);assert.ok(missing.sourcePath);assert.ok(missing.logPath);report.checks.missingFileVisible=true;
  await stop();
  const originals=await createOriginals(root,vips);
  start(join(base,'不存在的图片处理器'));
  const processor=await poll(p=>p.phase==='error');assert.match(processor.error,/无法启动图片处理器/);assert.ok(processor.error.includes(originals[0].file));assert.ok(processor.processorPath);report.checks.processorErrorIncludesPaths=true;
  await stop();
  const first=originals[0].file,bytes=await readFile(first);await writeFile(first,'损坏原图');
  start(vips);
  const corrupt=await poll(p=>p.phase==='error');assert.match(corrupt.error,/退出状态/);assert.match(corrupt.error,/错误输出/);assert.ok(corrupt.error.includes(first));report.checks.corruptImageDetailedError=true;
  await writeFile(first,bytes);
  const ready=await poll(p=>p.phase==='ready');assert.equal(ready.completed,11);assert.equal(ready.total,11);report.checks.recoveredWithoutRestart=true;
  assert.ok(events.some(p=>p.phase==='processing'&&p.currentFile&&p.elapsedMs>=0));assert.ok(events.some(p=>p.completed>0&&p.completed<11));report.checks.liveFileAndCountProgress=true;
  const response=await fetch('http://127.0.0.1:1437/catalog');assert.equal(response.status,200);report.checks.catalogReady=true;
  report.passed=true;
}finally{await stop();await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));await writeFile(join(base,'events.json'),JSON.stringify(events,null,2));await rm(root,{recursive:true,force:true});}
