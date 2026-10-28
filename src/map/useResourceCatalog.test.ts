// @vitest-environment jsdom
import { renderHook, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useResourceCatalog } from './useResourceCatalog';
import { parseCatalog } from './resourceCatalog';
const image = {url:'/zoomify/abc123/',width:49969,height:27750};
const catalog = {locations:[1,2,3].map((i,index)=>({id:`place-${i}`,label:['左屏','中屏','右屏'][index],images:[image,image]})),maps:[1,2,3,4,5,6,7,8,9,10].map(i=>({...image,id:`map-${i}`,label:`图${i}`}))};
const progress={phase:'processing',completed:3,total:11,currentFile:'图1.jpg',elapsedMs:1234,message:'正在处理原图'};
class Socket {
  static instances:Socket[]=[];
  onmessage:((event:{data:string})=>void)|null=null;
  onopen:(()=>void)|null=null;
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
  expect(hook.result.current.catalog?.maps).toHaveLength(10);expect(hook.result.current.progress?.phase).toBe('ready');
});
it('忽略已关闭连接的消息，并取消待执行重连',()=>{
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));const ws=Socket.instances[0];
  const oldMessage=ws.onmessage;act(()=>ws.onclose?.());
  act(()=>oldMessage?.({data:JSON.stringify({progress,catalog:null})}));expect(hook.result.current.progress?.phase).toBe('error');
  hook.unmount();act(()=>vi.advanceTimersByTime(10000));expect(Socket.instances).toHaveLength(1);
});
it('拒绝不合法目录和跨域瓦片地址，支持原图各自尺寸',()=>{
  expect(parseCatalog(catalog)).toEqual(catalog);
  expect(parseCatalog({...catalog,maps:catalog.maps.slice(0,1)})?.maps).toHaveLength(1);
  expect(parseCatalog({...catalog,maps:[...catalog.maps,...catalog.maps.slice(0,1)]})).toBeNull();
  expect(parseCatalog({...catalog,maps:[{...image,url:'http://other/'}]})).toBeNull();
  expect(parseCatalog({...catalog,locations:[]})).toBeNull();
  const original={...catalog,locations:catalog.locations.map(p=>({...p,images:[image,{...image,width:79219,height:46250}]}))};
  expect(parseCatalog(original)).toEqual(original);
});

it('ready 缺少合法目录时明确显示错误，重连后仍能收到完成目录',()=>{
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));const ws=Socket.instances[0];
  act(()=>ws.publish({progress,catalog:null}));
  act(()=>ws.publish({progress:{...progress,phase:'ready',completed:11},catalog:null}));
  expect(hook.result.current.progress?.phase).toBe('error');expect(hook.result.current.catalog).toBeNull();
  expect(hook.result.current.progress?.error).toContain('目录');
  expect(hook.result.current.progress?.error).toContain(ws.url);
  act(()=>vi.advanceTimersByTime(1000));
  act(()=>Socket.instances[1].publish({progress:{...progress,phase:'ready',completed:11},catalog}));
  expect(hook.result.current.catalog).toEqual(catalog);
});
it('直接显示生产服务总数为零的缺图错误和日志，不停留在连接文案',()=>{
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));
  const error={phase:'error',completed:0,total:0,elapsedMs:0,message:'地图准备失败，修复文件后自动重试',error:'缺少原始图片：C:\\地图资源\\左屏 中的图片 1',logPath:'C:\\地图资源\\.cache\\资源处理记录.txt'};
  act(()=>Socket.instances[0].publish({progress:error,catalog:null}));
  expect(hook.result.current.progress).toEqual(error);expect(hook.result.current.message).toBe(error.message);
  act(()=>vi.advanceTimersByTime(600000));
  expect(Socket.instances).toHaveLength(1);expect(fetch).not.toHaveBeenCalled();
});
it('通知连接十秒未建立即明确显示地址和连接超时，之后重试',()=>{
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));const ws=Socket.instances[0];
  act(()=>vi.advanceTimersByTime(9999));expect(hook.result.current.progress).toBeNull();
  act(()=>vi.advanceTimersByTime(1));
  expect(hook.result.current.progress?.phase).toBe('error');
  expect(hook.result.current.progress?.error).toContain('连接超时');
  expect(hook.result.current.progress?.error).toContain(ws.url);expect(ws.close).toHaveBeenCalled();
  act(()=>vi.advanceTimersByTime(1000));expect(Socket.instances).toHaveLength(2);
});
it('连接已建立但十秒没有首条状态时显示错误；退出取消所有超时和重连',()=>{
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));const ws=Socket.instances[0];
  act(()=>ws.onopen?.());expect(hook.result.current.message).toContain('等待');
  act(()=>vi.advanceTimersByTime(10000));
  expect(hook.result.current.progress?.error).toContain('未收到');
  expect(hook.result.current.progress?.error).toContain(ws.url);
  hook.unmount();expect(vi.getTimerCount()).toBe(0);
});
it('非法JSON明确报告消息错误及地址，避免无期限等待',()=>{
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));const ws=Socket.instances[0];
  act(()=>ws.onmessage?.({data:'bad-json'}));
  expect(hook.result.current.progress?.phase).toBe('error');
  expect(hook.result.current.progress?.error).toContain('JSON');expect(hook.result.current.progress?.error).toContain(ws.url);
});
