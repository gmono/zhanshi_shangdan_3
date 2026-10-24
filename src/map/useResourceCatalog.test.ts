// @vitest-environment jsdom
import { renderHook, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useResourceCatalog } from './useResourceCatalog';
import { parseCatalog } from './resourceCatalog';
const image = {url:'/zoomify/abc123/',width:49969,height:27750};
const catalog = {locations:[1,2,3].map(i=>({id:`place-${i}`,label:`地点${i}`,images:[image,image]})),maps:[1,2,3,4,5].map(i=>({...image,id:`map-${i}`,label:`图${i}`}))};
const progress={phase:'processing',completed:3,total:11,currentFile:'图1.jpg',elapsedMs:1234,message:'正在处理原图'};
class Socket {
  static instances:Socket[]=[];
  onmessage:((event:{data:string})=>void)|null=null;
  onclose:(()=>void)|null=null;
  onerror:(()=>void)|null=null;
  close=vi.fn();
  constructor(public url:string){Socket.instances.push(this);}
  publish(value:unknown){this.onmessage?.({data:JSON.stringify(value)});}
}
beforeEach(()=>{vi.useFakeTimers();Socket.instances=[];vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('fetch',vi.fn());});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it('未连接不建立资源连接；连接后直接接收目录，断开立即隐藏目录',()=>{
  const hook=renderHook(({enabled})=>useResourceCatalog('192.168.1.2',enabled,false),{initialProps:{enabled:false}});
  expect(Socket.instances).toHaveLength(0);
  hook.rerender({enabled:true});const ws=Socket.instances[0];expect(ws.url).toBe('ws://192.168.1.2:1421/events');
  act(()=>ws.publish({progress:{...progress,phase:'ready',completed:11},catalog}));
  expect(hook.result.current.catalog?.maps[0].width).toBe(49969);
  hook.rerender({enabled:false});expect(hook.result.current.catalog).toBeNull();expect(ws.close).toHaveBeenCalled();
});
it('进度和详细错误收到消息即显示，无需推进任何定时器，也不请求HTTP目录',()=>{
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));const ws=Socket.instances[0];
  act(()=>ws.publish({progress,catalog:null}));expect(hook.result.current.progress).toEqual(progress);
  const error={...progress,phase:'error',message:'处理失败',error:'vips.exe 退出状态 1：无法解码原图',logPath:'C:\\地图资源\\.cache\\资源处理记录.txt'};
  act(()=>ws.publish({progress:error,catalog:null}));expect(hook.result.current.progress).toEqual(error);
  act(()=>vi.advanceTimersByTime(10000));expect(fetch).not.toHaveBeenCalled();expect(Socket.instances).toHaveLength(1);
});
it('断线立即显示错误，仅连接失败后重连，新连接直接收到完成目录',()=>{
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));const ws=Socket.instances[0];
  act(()=>ws.publish({progress,catalog:null}));act(()=>ws.onclose?.());
  expect(hook.result.current.progress?.phase).toBe('error');expect(hook.result.current.progress?.error).toContain(ws.url);
  act(()=>vi.advanceTimersByTime(1000));expect(Socket.instances).toHaveLength(2);
  act(()=>Socket.instances[1].publish({progress:{...progress,phase:'ready',completed:11},catalog}));
  expect(hook.result.current.catalog?.maps).toHaveLength(5);expect(hook.result.current.progress?.phase).toBe('ready');
});
it('忽略已关闭连接的消息，并取消待执行重连',()=>{
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));const ws=Socket.instances[0];
  const oldMessage=ws.onmessage;act(()=>ws.onclose?.());
  act(()=>oldMessage?.({data:JSON.stringify({progress,catalog:null})}));expect(hook.result.current.progress?.phase).toBe('error');
  hook.unmount();act(()=>vi.advanceTimersByTime(10000));expect(Socket.instances).toHaveLength(1);
});
it('拒绝不合法目录和跨域瓦片地址，支持原图各自尺寸',()=>{
  expect(parseCatalog(catalog)).toEqual(catalog);
  expect(parseCatalog({...catalog,maps:[{...image,url:'http://other/'}]})).toBeNull();
  expect(parseCatalog({...catalog,locations:[]})).toBeNull();
  const original={...catalog,locations:catalog.locations.map(p=>({...p,images:[image,{...image,width:79219,height:46250}]}))};
  expect(parseCatalog(original)).toEqual(original);
});

it('ready 必须同时带合法目录；坏消息不能覆盖有效进度',()=>{
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));const ws=Socket.instances[0];
  act(()=>ws.publish({progress,catalog:null}));
  act(()=>ws.publish({progress:{...progress,phase:'ready',completed:11},catalog:null}));
  expect(hook.result.current.progress?.phase).toBe('processing');expect(hook.result.current.catalog).toBeNull();
});
