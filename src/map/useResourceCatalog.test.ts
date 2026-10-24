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
