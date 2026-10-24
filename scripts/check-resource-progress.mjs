// 直接订阅生产 Rust WebSocket，验证主动推送；不查询进度或目录接口。
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {WebSocket} from 'ws';
import {createOriginals} from './create-e2e-originals.mjs';
const base=resolve('tmp/resource-progress-check');await mkdir(base,{recursive:true});
const root=await mkdtemp(join(base,'originals-'));const events=[];let child,exited,socket,current=[];
const binary=process.env.E2E_NATIVE_BINARY;if(!binary)throw Error('缺少 E2E_NATIVE_BINARY');
const vips=process.env.VIPS_BIN||'vips';
const delay=ms=>new Promise(ok=>setTimeout(ok,ms));
async function connect(){
  for(let i=0;i<600;i++){
    const ws=new WebSocket('ws://127.0.0.1:1437/events');
    ws.on('message',b=>{const event=JSON.parse(String(b));events.push(event);current.push(event);});
    const opened=await new Promise(ok=>{ws.once('open',()=>ok(true));ws.once('error',()=>ok(false));});
    if(opened){socket=ws;return ws;}ws.terminate();await delay(50);
  }throw Error('生产服务未能建立进度通知连接');
}
async function start(processor,source=root){current=[];child=spawn(resolve(binary),[source,processor,'127.0.0.1:1437','8797'],{stdio:'inherit'});exited=new Promise((ok,no)=>{child.once('exit',ok);child.once('error',no);});await connect();}
async function stop(){socket?.terminate();if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await exited;}}
function next(test,ws=socket){
  const existing=current.find(test);if(existing)return Promise.resolve(existing);
  return new Promise((ok,no)=>{
    const timeout=setTimeout(()=>{clean();no(Error('未收到预期的服务端进度通知'));},60000);
    const message=b=>{const event=JSON.parse(String(b));if(test(event)){clean();ok(event);}};
    const close=()=>{clean();no(Error('通知连接意外关闭'));};
    function clean(){clearTimeout(timeout);ws.off('message',message);ws.off('close',close);}
    ws.on('message',message);ws.on('close',close);
  });
}
const report={checks:{}};
try{
  const blocked=join(base,'无法作为目录的文件');await writeFile(blocked,'not a directory');
  await start(vips,blocked);
  const directoryError=(await next(e=>e.progress?.phase==='error')).progress;assert.ok(directoryError.error.includes(blocked));report.checks.directoryFailureVisible=true;
  await stop();await start(vips);
  const missing=(await next(e=>e.progress?.phase==='error')).progress;assert.match(missing.error,/缺少原始图片/);assert.ok(missing.logPath);report.checks.missingFileVisible=true;
  await stop();const originals=await createOriginals(root,vips);
  await start(join(base,'不存在的图片处理器'));
  const processor=(await next(e=>e.progress?.phase==='error')).progress;assert.match(processor.error,/无法启动图片处理器/);assert.ok(processor.error.includes(originals[0].file));report.checks.processorErrorIncludesPaths=true;
  await stop();const first=originals[0].file,bytes=await readFile(first);await writeFile(first,'损坏原图');
  await start(vips);
  const corrupt=(await next(e=>e.progress?.phase==='error')).progress;assert.match(corrupt.error,/退出状态/);assert.match(corrupt.error,/错误输出/);report.checks.corruptImageDetailedError=true;
  await writeFile(first,bytes);
  const ready=await next(e=>e.progress?.phase==='ready');assert.equal(ready.progress.completed,11);assert.equal(ready.progress.total,11);report.checks.recoveredWithoutRestart=true;
  assert.ok(current.some(e=>e.progress?.phase==='processing'&&e.progress.currentFile));assert.ok(current.some(e=>e.progress?.completed>0&&e.progress.completed<11));report.checks.liveFileAndCountProgress=true;
  assert.equal(ready.catalog.maps.length,5);assert.equal(ready.catalog.locations.length,3);report.checks.catalogPushedWithReady=true;
  for(const event of current)if(event.progress.phase==='ready')assert.ok(event.catalog,'ready不能早于目录');
  socket.terminate();current=[];await connect();const replay=await next(e=>e.progress?.phase==='ready');assert.deepEqual(replay.catalog,ready.catalog);report.checks.reconnectReceivesCurrentSnapshot=true;
  report.passed=true;
}finally{await stop();await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));await writeFile(join(base,'events.json'),JSON.stringify(events,null,2));await rm(root,{recursive:true,force:true});}
