// @vitest-environment jsdom
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useResourceCatalog } from './useResourceCatalog';
import { parseCatalog } from './resourceCatalog';
const image = {url:'/zoomify/abc123/',width:49969,height:27750};
const catalog = {locations:[1,2,3].map(i=>({id:`place-${i}`,label:`地点${i}`,images:[image,image]})),maps:[1,2,3,4,5].map(i=>({...image,id:`map-${i}`,label:`图${i}`}))};
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('未连接不请求图片或目录，连接后读取真实尺寸，断开立即隐藏目录',async()=>{
  const fetch=vi.fn(async()=>({ok:true,json:async()=>catalog}));vi.stubGlobal('fetch',fetch);
  const hook=renderHook(({enabled})=>useResourceCatalog('192.168.1.2',enabled,false),{initialProps:{enabled:false}});
  expect(fetch).not.toHaveBeenCalled();expect(hook.result.current.catalog).toBeNull();
  hook.rerender({enabled:true});await waitFor(()=>expect(hook.result.current.catalog?.maps[0].width).toBe(49969));
  hook.rerender({enabled:false});expect(hook.result.current.catalog).toBeNull();
});
it('拒绝不合法目录和跨域瓦片地址',()=>{
  expect(parseCatalog(catalog)).toEqual(catalog);
  expect(parseCatalog({...catalog,maps:[{...image,url:'http://other/'}]})).toBeNull();
  expect(parseCatalog({...catalog,locations:[]})).toBeNull();
});
it('直接接受每张原图自己的尺寸，不要求用户缩放或配准原图',()=>{
  const original={...catalog,locations:catalog.locations.map(p=>({...p,images:[image,{...image,width:79219,height:46250}]}))};
  expect(parseCatalog(original)).toEqual(original);
});
it('连接成功但 Windows 仍在切片时持续重试，资源就绪后自动显示',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce({ok:false,json:async()=>({message:'正在准备地图资源'})}).mockResolvedValue({ok:true,json:async()=>catalog});
  vi.stubGlobal('fetch',fetch);
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));
  await waitFor(()=>expect(hook.result.current.message).toBe('正在准备地图资源'));
  expect(hook.result.current.catalog).toBeNull();
  await waitFor(()=>expect(hook.result.current.catalog?.maps).toHaveLength(5),{timeout:4500});
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('Windows处理进度和完整错误通过状态流显示给用户',async()=>{
  const progress={phase:'error',completed:3,total:11,currentFile:'图1.jpg',sourcePath:'C:\\地图资源\\图1.jpg',elapsedMs:1234,message:'图片处理失败',error:'vips.exe 退出码 1：无法解码原图；完整诊断内容'};
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({message:progress.message,progress})})));
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));
  await waitFor(()=>expect(hook.result.current.progress).toEqual(progress));
  expect(hook.result.current.message).toContain('图片处理失败');
});
it('处理中断线时发布详细错误，不能把旧进度留在界面上冒充仍在处理',async()=>{
  const progress={phase:'processing',completed:2,total:11,elapsedMs:2000,currentFile:'图3.jpg',message:'正在解码'};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce({ok:false,json:async()=>({message:'正在解码',progress})}).mockRejectedValue(new Error('Failed to fetch')));
  const hook=renderHook(()=>useResourceCatalog('192.168.1.2',true,false));
  await waitFor(()=>expect(hook.result.current.progress?.phase).toBe('processing'));
  await waitFor(()=>expect(hook.result.current.progress?.phase).toBe('error'),{timeout:2500});
  expect(hook.result.current.progress?.error).toContain('http://192.168.1.2:1421/catalog');
  expect(hook.result.current.progress?.error).toContain('Failed to fetch');
});
