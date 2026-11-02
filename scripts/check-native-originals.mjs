import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,copyFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createOriginals} from './create-e2e-originals.mjs';
const reports=resolve('tmp/native-original-contract');await mkdir(reports,{recursive:true});
const root=await mkdtemp(join(reports,'run-'));
const binary=process.env.E2E_NATIVE_BINARY;if(!binary)throw Error('缺少 E2E_NATIVE_BINARY');
const endpoint='http://127.0.0.1:1436/catalog';const report={checks:{}};let child;
function start(){child=spawn(resolve(binary),[root,process.env.VIPS_BIN||'vips','127.0.0.1:1436','8796'],{stdio:'inherit'});}
async function stop(){if(!child||child.exitCode!==null)return;const p=child;await new Promise(ok=>{p.once('exit',ok);p.kill();});}
async function poll(predicate,stage){
  const started=Date.now(),deadline=started+120000;let latest;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw Error(`${stage}：原生资源服务已退出，退出码 ${child.exitCode}`);
    try{
      const r=await fetch(endpoint,{signal:AbortSignal.timeout(2000)});const body=await r.json();
      latest={status:r.status,body};
      if(predicate(r,body)){(report.waits??={})[stage]={elapsedMs:Date.now()-started,lastStatus:r.status};return body;}
    }catch(error){latest={error:String(error)};}
    await new Promise(ok=>setTimeout(ok,250));
  }
  throw Error(`${stage}：120秒内原生资源服务未达到预期状态\n地址：${endpoint}\n最后响应：${JSON.stringify(latest)}`);
}
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
try{
  start();await poll(r=>r.status===503,'空安装目录检查');report.checks.emptyInstallDirectory=true;
  const originals=await createOriginals(root);
  const first=await poll((r,b)=>r.ok&&b.maps?.length===10,'首次十张地图切片');
  assert.equal(first.locations[0].images[0].width,640);assert.equal(first.locations[0].images[1].width,800);report.checks.originalDimensions=true;
  for(const source of originals)assert.equal(await hash(source.file),source.sha256);report.checks.originalBytesUnchanged=true;
  await stop();
  const firstSource=originals[0],replacement=originals[1];await copyFile(replacement.file,firstSource.file);
  start();const changed=await poll((r,b)=>r.ok&&b.locations?.[0]?.images?.[0]?.width===800,'同名替换后重建缓存');
  assert.equal(changed.locations[0].images[0].height,440);report.checks.sameNameReplacementRebuildsCache=true;
  assert.equal(await hash(firstSource.file),replacement.sha256);report.checks.replacementBytesUnchanged=true;
  report.passed=true;
}catch(error){report.error=String(error.stack||error);throw error;}
finally{await stop();await writeFile(join(reports,'result.json'),JSON.stringify(report,null,2));}
