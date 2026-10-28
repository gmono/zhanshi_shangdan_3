import {test,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {WebSocket} from 'ws';

test('Windows 展示端进度面板铺满窗口，详细错误及断线状态可见',async({page})=>{
  let send: (progress: unknown) => void = () => {};
  let disconnect: () => void = () => {};
  let catalogRequests=0;
  page.on('request',r=>{if(/\/(catalog|progress)$/.test(r.url()))catalogRequests++;});
  let progress={phase:'processing',completed:3,total:11,elapsedMs:12500,message:'正在解码原图并生成显示瓦片',currentFile:'图1.jpg',sourcePath:'C:\\展厅App\\地图资源\\图1.jpg',processorPath:'C:\\展厅App\\tools\\vips.exe',error:''};
  await page.routeWebSocket('ws://127.0.0.1:1421/events',ws=>{
    send=progress=>ws.send(JSON.stringify({progress,catalog:null}));
    disconnect=()=>ws.close();
    send(progress);
  });
  await page.goto('/?role=display');
  await expect(page.getByRole('heading',{name:'正在准备地图资源'})).toBeVisible();
  await expect(page.getByText(/已完成 3 \/ 11/)).toBeVisible();
  await expect(page.getByText(/当前文件：图1.jpg/)).toBeVisible();
  await expect(page.getByRole('progressbar',{name:'地图准备进度'})).toBeVisible();
  const box=await page.locator('.resource-status').boundingBox();
  const viewport=page.viewportSize()!;
  expect(box!.width).toBeGreaterThanOrEqual(viewport.width-1);
  expect(box!.height).toBeGreaterThanOrEqual(viewport.height-1);
  await page.screenshot({path:`tmp/e2e/${test.info().project.name}-processing.png`});
  progress={...progress,phase:'error',message:'地图准备失败，修复文件后自动重试',error:'原图：C:\\展厅App\\地图资源\\图1.jpg\n退出状态：exit code 1\n错误输出：unexpected end of file'};
  send(progress);
  await expect(page.getByRole('heading',{name:'地图准备失败'})).toBeVisible();
  await expect(page.locator('.resource-error')).toContainText('unexpected end of file');
  await expect(page.locator('.resource-error')).toContainText('exit code 1');
  await page.screenshot({path:`tmp/e2e/${test.info().project.name}-processing-error.png`});
  disconnect();
  await expect(page.locator('.resource-error')).toContainText('ws://127.0.0.1:1421/events');
  await expect(page.getByText('地图处理通知连接中断，正在重连')).toBeVisible();
  expect(catalogRequests).toBe(0);
});

test('缺少原图时实际 Rust 通知的零总数错误在界面完整显示',async({page,request})=>{
  const base=resolve('tmp/e2e');await mkdir(base,{recursive:true});
  const root=await mkdtemp(join(base,'missing-original-'));
  const binary=process.env.E2E_NATIVE_BINARY||resolve(process.platform==='win32'?'tests/native/target/debug/exhibition-resource-test-server.exe':'tmp/native-test-target/debug/exhibition-resource-test-server');
  const child=spawn(binary,[root,process.env.VIPS_BIN||'vips','127.0.0.1:1438','8798'],{stdio:'pipe'});
  let failure='';child.on('error',error=>{failure=error.message;});child.stderr.on('data',data=>{failure+=String(data);});
  const exited=new Promise<void>(ok=>child.once('exit',()=>ok()));
  const sockets:WebSocket[]=[];
  try{
    await expect.poll(async()=>{
      if(failure)throw Error(failure);
      try{return (await (await request.get('http://127.0.0.1:1438/progress')).json()).phase;}catch{return '';}
    }).toBe('error');
    // 只转发真实生产服务消息，不能以伪造响应代替缺图错误。
    await page.routeWebSocket('ws://127.0.0.1:1421/events',client=>{
      const server=new WebSocket('ws://127.0.0.1:1438/events');sockets.push(server);
      server.on('message',data=>client.send(String(data)));
      server.on('error',()=>client.close());
      client.onClose(()=>server.terminate());
    });
    await page.goto('/?role=display');
    await expect(page.getByRole('heading',{name:'地图准备失败'})).toBeVisible();
    await expect(page.locator('.resource-error')).toContainText('缺少原始图片');
    await expect(page.locator('.resource-error')).toContainText(join(root,'左屏'));
    await expect(page.locator('.resource-error')).toContainText('图片 1');
    await expect(page.getByText(/错误记录：/)).toContainText('资源处理记录.txt');
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.locator('.resource-status')).not.toContainText('NaN');
    await expect(page.locator('.resource-status')).not.toContainText('正在连接地图处理通知服务');
    await page.screenshot({path:`tmp/e2e/${test.info().project.name}-missing-original-error.png`});
  }finally{
    for(const socket of sockets)socket.terminate();
    if(child.exitCode===null&&child.signalCode===null){child.kill();await exited;}
    await rm(root,{recursive:true,force:true});
  }
});

test('通知连接已建立却不报告状态时十秒明确报错，随后自动重连',async({page})=>{
  let connections=0,queries=0;
  page.on('request',request=>{if(/\/(catalog|progress)$/.test(request.url()))queries++;});
  await page.clock.install();
  await page.routeWebSocket('ws://127.0.0.1:1421/events',()=>{connections++;});
  await page.goto('/?role=display');
  await expect(page.locator('.resource-status p').first()).toHaveText('地图通知连接已建立，正在等待 Windows 返回当前状态…');
  await page.clock.fastForward(10000);
  await expect(page.getByRole('heading',{name:'地图准备失败'})).toBeVisible();
  await expect(page.locator('.resource-error')).toContainText('10秒内未收到首条有效状态');
  await expect(page.locator('.resource-error')).toContainText('ws://127.0.0.1:1421/events');
  await page.screenshot({path:`tmp/e2e/${test.info().project.name}-notification-timeout.png`});
  await page.clock.fastForward(1000);
  await expect.poll(()=>connections).toBe(2);
  expect(queries).toBe(0);
});

for(const role of ['controller','display'])test(`${role} 已显示地图后通知断线也必须显示明确错误`,async({page})=>{
  let connections=0,disconnect=async()=>{};
  await page.addInitScript(()=>localStorage.setItem('exhibition-connection-v2',JSON.stringify({ip:'127.0.0.1'})));
  await page.routeWebSocket('ws://127.0.0.1:1421/events',client=>{
    if(++connections>1)return;
    const server=client.connectToServer();
    disconnect=async()=>{
      await client.close({code:1012,reason:'测试中断通知'});
      await server.close({code:1012,reason:'测试中断通知'});
    };
  });
  await page.goto(`/?role=${role}`);
  await expect(page.locator('.map-stage[data-page="comparison"]')).toBeVisible();
  await disconnect();
  await expect(page.getByRole('heading',{name:'地图准备失败'})).toBeVisible({timeout:3000});
  await expect(page.locator('.resource-error')).toContainText('ws://127.0.0.1:1421/events');
  // 保留已加载的地图对象，错误在上层显示；恢复后继续使用原有画布。
  await expect(page.locator('.map-stage[data-page="comparison"]')).toHaveCount(1);
});
