import {test,expect} from '@playwright/test';
import {WebSocket} from 'ws';
const host=process.env.E2E_SERVER_IP||'127.0.0.1';

test('iPad 控制端连接原生服务后加载原图目录和瓦片，并切换五张大图',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const tiles:string[]=[];page.on('response',r=>{if(r.status()===200&&/\/zoomify\/.*\.jpg/.test(r.url()))tiles.push(r.url());});
  await page.goto('/?role=controller');
  await expect(page.getByRole('button',{name:'连接 Windows 大屏'})).toBeVisible();
  expect(tiles).toHaveLength(0);
  await page.getByRole('button',{name:'连接 Windows 大屏'}).click();
  await page.getByPlaceholder('192.168.1.100').fill(host);
  await page.getByRole('button',{name:'保存连接',exact:true}).click();
  await expect(page.getByText(/已连接 \d+ 块大屏/)).toBeVisible();
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await expect(page.locator('.map-stage[data-page="comparison"]')).toBeVisible();
  await expect.poll(()=>new Set(tiles.map(u=>new URL(u).pathname.split('/')[2])).size).toBeGreaterThanOrEqual(6);
  await expect(page.locator('.map-stage[data-page="comparison"] canvas')).toHaveCount(6);
  await expect.poll(()=>page.locator('.map-stage[data-page="comparison"] canvas').evaluateAll(canvases=>canvases.every(element=>{
    const canvas=element as HTMLCanvasElement;if(!canvas.width||!canvas.height)return false;
    const context=canvas.getContext('2d');if(!context)return false;
    const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
    for(let i=0;i<pixels.length;i+=32)if(pixels[i]||pixels[i+1]||pixels[i+2])return true;
    return false;
  }))).toBeTruthy();
  const catalog=await request.get(`http://${host}:1421/catalog`);expect(catalog.ok()).toBeTruthy();
  const body=await catalog.json();expect(body.locations[0].images[0].width).toBe(640);expect(body.locations[0].images[1].width).toBe(800);
  const observer=new WebSocket(`ws://${host}:8787`);const states:any[]=[];
  await new Promise<void>((resolve,reject)=>{observer.once('open',()=>{observer.send(JSON.stringify({type:'hello',role:'display',room:'exhibition-main-room'}));resolve();});observer.once('error',reject);});
  observer.on('message',b=>{const m=JSON.parse(String(b));if(m.type==='snapshot'&&m.state)states.push(m.state);});
  try{
    for(let i=1;i<=5;i++){
      await page.getByRole('button',{name:`图${i}`,exact:true}).click();
      await expect(page.locator(`.map-stage[data-page="map-${i}"]`)).toBeVisible();
      await expect.poll(()=>tiles.some(url=>url.includes(`/zoomify/map-${i}/`))).toBeTruthy();
      await expect.poll(()=>states.at(-1)?.page).toBe(`map-${i}`);
      await page.getByRole('button',{name:'返回',exact:true}).click();
    }
    expect(errors).toEqual([]);
    await page.screenshot({path:`tmp/e2e/${test.info().project.name}-connected.png`});
  }finally{observer.terminate();}
});
