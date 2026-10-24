// 测试代理只记录请求；目录、切片和同步均由生产 Rust 实现提供。
import {spawn} from 'node:child_process';
import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {appendFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createOriginals} from './create-e2e-originals.mjs';
const dir=resolve(process.env.E2E_REPORT_DIR||'tmp/e2e');await mkdir(dir,{recursive:true});
const children=[];const logs=resolve(dir,'http-requests.ndjson');await writeFile(logs,'');
const host=process.env.E2E_SERVER_IP||'127.0.0.1';
function launch(command,args,env={}){const child=spawn(command,args,{stdio:'inherit',env:{...process.env,...env}});children.push(child);child.on('error',e=>{console.error(e);process.exitCode=1;});return child;}
let proxy;
if(process.env.E2E_WINDOWS_APP){
  launch(process.env.E2E_WINDOWS_APP,[]);
}else{
  const root=resolve(dir,'originals');await createOriginals(root);
  const binary=process.env.E2E_NATIVE_BINARY;
  if(binary)launch(resolve(binary),[root,process.env.VIPS_BIN||'vips',`${host}:1431`,'8787']);
  else launch('cargo',['run','--locked','--manifest-path','tests/native/Cargo.toml','--',root,process.env.VIPS_BIN||'vips',`${host}:1431`,'8787'],{CARGO_TARGET_DIR:resolve('tmp/native-test-target'),CARGO_BUILD_JOBS:'2'});
  proxy=createServer((req,res)=>{
    const upstream=request({hostname:host,port:1431,path:req.url,method:req.method,headers:req.headers},reply=>{
      let bytes=0;res.writeHead(reply.statusCode,reply.headers);reply.on('data',b=>bytes+=b.length);reply.pipe(res);
      reply.on('end',()=>void appendFile(logs,JSON.stringify({time:new Date().toISOString(),url:req.url,status:reply.statusCode,bytes,userAgent:req.headers['user-agent']})+'\n'));
    });upstream.on('error',()=>{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'正在准备地图资源'}));});req.pipe(upstream);
  });
  proxy.on('upgrade',(req,socket,head)=>{
    const upstream=connect(1431,host,()=>{
      upstream.write([req.method+' '+req.url+' HTTP/1.1',...Object.entries(req.headers).map(([name,value])=>name+': '+value),'',''].join('\r\n'));
      if(head.length)upstream.write(head);
      socket.pipe(upstream);upstream.pipe(socket);
    });
    upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
    socket.on('close',()=>upstream.destroy());upstream.on('close',()=>socket.destroy());
  });proxy.listen(1421,host);
}
if(!process.env.E2E_NO_FRONTEND)launch(process.execPath,[resolve('node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port',process.env.E2E_FRONTEND_PORT||'1430','--strictPort']);
await writeFile(resolve(dir,'server.json'),JSON.stringify({host,frontendPort:Number(process.env.E2E_FRONTEND_PORT||1430),windowsApp:process.env.E2E_WINDOWS_APP||null}));
let closing=false;
function close(){if(closing)return;closing=true;proxy?.close();for(const child of children)child.kill();setTimeout(()=>process.exit(),1000).unref();}
process.on('SIGTERM',close);process.on('SIGINT',close);
setInterval(()=>{},1000);
