import {test,expect} from '@playwright/test';
import {WebSocket} from 'ws';
const host=process.env.E2E_SERVER_IP||'127.0.0.1';

test('上一次 iOS 连接断网失去响应后，新连接等待母线清理并自动恢复',async({page})=>{
  test.setTimeout(60000);
  const connectStale=async()=>{
    let lastError:unknown;
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      const stale=new WebSocket(`ws://${host}:8787`,{autoPong:false});
      stale.on('error',()=>{});
      try{
        await new Promise<void>((resolve,reject)=>{stale.once('open',()=>resolve());stale.once('error',reject);});
        await new Promise<void>((resolve,reject)=>{
          stale.on('message',raw=>{try{if(JSON.parse(String(raw)).type==='snapshot')resolve();}catch(error){reject(error);}});
          stale.once('error',reject);
          stale.send(JSON.stringify({id:1,type:'hello',role:'controller',room:'exhibition-main-room'}));
        });
        return stale;
      }catch(error){lastError=error;stale.terminate();await new Promise(resolve=>setTimeout(resolve,250));}
    }
    throw lastError||new Error(`无法连接 Windows 同步端口：${host}:8787`);
  };
  const stale=await connectStale();
  try{
    await page.goto('/?role=controller');
    await page.getByRole('button',{name:'连接 Windows 大屏'}).click();
    await page.getByRole('textbox',{name:'Windows 地址',exact:true}).fill(host);
    await page.getByRole('button',{name:'保存连接',exact:true}).click();
    await expect(page.getByText(/已连接 \d+ 块大屏/)).toBeVisible({timeout:30000});
    await page.locator('.settings-page').getByRole('button',{name:'返回',exact:true}).click();
    await expect(page.locator('.map-stage[data-page="comparison"]')).toBeVisible();
  }finally{
    stale.terminate();
  }
});

test('iPad 控制端连接原生服务后加载原图目录和瓦片，并切换自动发现的十张大图',async({page,request})=>{
  test.setTimeout(300000);
  const settled = async () => {
    await expect.poll(() => page.locator('ion-router-outlet').evaluate(outlet => outlet.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'))).toBe(false);
  };
  const painted=async(pageId:string,count:number)=>{
    const canvases=page.locator(`.map-stage[data-page="${pageId}"] canvas`);
    await expect(canvases).toHaveCount(count);
    await expect.poll(()=>canvases.evaluateAll(elements=>elements.every(element=>{
      const canvas=element as HTMLCanvasElement;if(!canvas.width||!canvas.height)return false;
      const context=canvas.getContext('2d');if(!context)return false;
      const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
      let colored=0,samples=0;
      for(let i=0;i<pixels.length;i+=32){samples++;if(pixels[i]||pixels[i+1]||pixels[i+2])colored++;}
      return colored/samples>0.005;
    }))).toBeTruthy();
  };
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const tiles:string[]=[];page.on('response',r=>{if(r.status()===200&&/\/zoomify\/.*\.jpg/.test(r.url()))tiles.push(r.url());});
  await page.goto('/?role=controller');
  await expect(page.getByRole('button',{name:'连接 Windows 大屏'})).toBeVisible();
  expect(tiles).toHaveLength(0);
  await page.getByRole('button',{name:'连接 Windows 大屏'}).click();
  await page.getByRole('textbox',{name:'Windows 地址',exact:true}).fill(host);
  await page.getByRole('button',{name:'保存连接',exact:true}).click();
  await expect(page.getByText(/已连接 \d+ 块大屏/)).toBeVisible();
  await page.locator('.settings-page').getByRole('button',{name:'返回',exact:true}).click();
  await expect(page.locator('.map-stage[data-page="comparison"]')).toBeVisible();
  await expect.poll(()=>new Set(tiles.map(u=>new URL(u).pathname.split('/')[2])).size).toBeGreaterThanOrEqual(6);
  await painted('comparison',6);
  const displayPage=await page.context().newPage();
  await displayPage.setViewportSize({width:1920,height:1080});
  await displayPage.goto('/?role=display');
  await expect(displayPage.locator('.map-stage[data-page="comparison"]')).toBeVisible();
  await expect.poll(()=>displayPage.locator('.map-stage[data-page="comparison"] canvas').count()).toBe(6);
  const panel=page.getByRole('region',{name:'地图操作面板'});
  await expect(panel).toBeVisible();
  const mapButtons=panel.locator('.map-page-buttons ion-button');
  await expect(mapButtons).toHaveCount(10);
  expect(await mapButtons.allTextContents()).toEqual(Array.from({length:10},(_,i)=>`图${i+1}`));
  const checkLayout=async()=>{
    const viewport=page.viewportSize()!;
    const box=(await panel.boundingBox())!;
    expect(box.y).toBeGreaterThan(viewport.height/2);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y+box.height).toBeLessThan(viewport.height);
    const widths=await page.locator('.split-outer > .split-panel').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));
    expect(widths).toHaveLength(3);
    expect(Math.max(...widths)-Math.min(...widths)).toBeLessThan(1);
    await expect(page.locator('.outer-divider [role="slider"]')).toHaveCount(0);
    await expect(page.locator('.inner-divider [role="slider"]')).toHaveCount(3);
  };
  await checkLayout();
  for(const slider of await page.locator('.inner-divider [role="slider"]').all())await expect(slider).toHaveAttribute('aria-valuenow','0');
  const originalViewport=page.viewportSize()!;
  await page.setViewportSize({width:1194,height:834});
  await checkLayout();
  await page.screenshot({path:`tmp/e2e/${test.info().project.name}-capsule-landscape.png`});
  await page.setViewportSize(originalViewport);
  await page.screenshot({path:`tmp/e2e/${test.info().project.name}-initial.png`});
  const catalog=await request.get(`http://${host}:1421/catalog`);expect(catalog.ok()).toBeTruthy();
  const body=await catalog.json();expect(body.locations[0].images[0].width).toBe(640);expect(body.locations[0].images[1].width).toBe(800);
  expect(body.locations.map((place:any)=>place.label)).toEqual(['左屏','中屏','右屏']);
  for(const place of body.locations){expect(place.images[0].url).toContain('place-');expect(place.images[0].url).toContain('-1/');expect(place.images[1].url).toContain('-2/');}
  const observer=new WebSocket(`ws://${host}:8787`);const states:any[]=[];const envelopes:any[]=[];
  observer.on('message',b=>{const m=JSON.parse(String(b));envelopes.push(m);if(m.type==='snapshot'&&m.state)states.push(m.state);});
  await new Promise<void>((resolve,reject)=>{observer.once('open',()=>{observer.send(JSON.stringify({id:1,type:'hello',role:'display',room:'exhibition-main-room'}));resolve();});observer.once('error',reject);});
  try{
    for(let i=1;i<=10;i++){
      await page.getByRole('button',{name:`图${i}`,exact:true}).click();
      await expect(page.locator(`.map-stage[data-page="map-${i}"]`)).toBeVisible();
      await expect.poll(()=>tiles.some(url=>url.includes(`/zoomify/map-${i}/`))).toBeTruthy();
      await expect.poll(()=>states.at(-1)?.page).toBe(`map-${i}`);
      await expect(displayPage.locator(`.map-stage[data-page="map-${i}"]`)).toBeVisible();
      await expect(displayPage.locator(`.map-stage[data-page="map-${i}"] canvas`)).toHaveCount(1);
      await painted(`map-${i}`,1);
      const initialCamera=structuredClone(states.at(-1).mapViews[`map-${i}`]);
      const target=page.locator(`.map-stage[data-page="map-${i}"] .map-target`);
      await expect.poll(async()=>Math.abs((await target.boundingBox())!.x)).toBeLessThan(1);
      const bounds=(await target.boundingBox())!;
      await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
      await target.dblclick();
      await expect.poll(()=>states.at(-1)?.mapViews?.[`map-${i}`]?.zoom).toBeGreaterThan(initialCamera.zoom+0.2);
      await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
      await page.mouse.down();
      await page.mouse.move(bounds.x+bounds.width/2+100,bounds.y+bounds.height/2+50,{steps:8});
      await page.mouse.up();
      await panel.getByRole('button',{name:'返回',exact:true}).click();
      await painted('comparison',6);
      await expect.poll(()=>states.at(-1)?.page).toBe('comparison');
      await expect(panel.getByRole('button',{name:'图1',exact:true})).toBeVisible();
      await settled();
      await expect(displayPage.locator('.map-stage[data-page="comparison"]')).toBeVisible();
      await expect(displayPage.locator('.map-stage[data-page="comparison"] canvas')).toHaveCount(6);
      await expect.poll(()=>states.at(-1)?.innerSplits?.every((splits:number[])=>splits.every(value=>value===0))).toBeTruthy();
      const entryStart=states.length;
      await page.getByRole('button',{name:`图${i}`,exact:true}).click();
      await expect(page.locator(`.map-stage[data-page="map-${i}"]`)).toBeVisible();
      await expect.poll(()=>states.at(-1)?.page).toBe(`map-${i}`);
      await expect.poll(()=>states.at(-1)?.mapViews?.[`map-${i}`]).toEqual(initialCamera);
      await painted(`map-${i}`,1);
      const entryStates=states.slice(entryStart).filter(state=>state.page===`map-${i}`);
      expect(entryStates.length).toBeGreaterThan(0);
      for(const state of entryStates)expect(state.mapViews[`map-${i}`]).toEqual(initialCamera);
      await page.getByRole('region',{name:'地图操作面板'}).getByRole('button',{name:'返回',exact:true}).click();
      await painted('comparison',6);
      await expect.poll(()=>states.at(-1)?.page).toBe('comparison');
      await expect(panel.getByRole('button',{name:'图1',exact:true})).toBeVisible();
      await settled();
    }
    expect(errors).toEqual([]);
    await displayPage.close();
    expect(envelopes.every((m,i)=>Number.isSafeInteger(m.id)&&m.id>0&&(i===0||m.id>envelopes[i-1].id))).toBeTruthy();
    expect(envelopes.some(m=>m.type==='snapshot'&&Number.isSafeInteger(m.sourceId))).toBeTruthy();
    await page.screenshot({path:`tmp/e2e/${test.info().project.name}-connected.png`});
  }finally{
    await test.info().attach('同步消息序列',{body:JSON.stringify(envelopes,null,2),contentType:'application/json'});
    observer.terminate();
  }
});
