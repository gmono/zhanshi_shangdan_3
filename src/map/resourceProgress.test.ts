// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ResourceStatus } from './ResourceStatus';
import { resourceProgress$, parseProgress, delay } from './resourceProgress';

const progress={phase:'processing',completed:3,total:11,elapsedMs:2400,currentFile:'图1.jpg',sourcePath:'C:\\地图资源\\图1.jpg',message:'正在切片'};
it('通过 RxJS Subject 发布可订阅的处理状态',async()=>{
  const received:unknown[]=[];const subscription=resourceProgress$.subscribe(value=>received.push(value));
  await delay(0);resourceProgress$.next(progress);await delay(0);
  expect(received.at(-1)).toEqual(progress);subscription.unsubscribe();resourceProgress$.next(null);
});
it('准备界面显示进度、当前文件和耗时',()=>{
  const html=renderToStaticMarkup(createElement(ResourceStatus,{message:'',progress}));
  expect(html).toContain('已完成 3 / 11');expect(html).toContain('图1.jpg');expect(html).toContain('2.4');expect(html).toContain('<progress');
});
it('错误界面完整显示错误、处理器和日志路径',()=>{
  const error={...progress,phase:'error',error:'退出码 1\n无法解码：unexpected end of file',processorPath:'C:\\tools\\vips.exe',logPath:'C:\\地图资源\\.cache\\资源处理记录.txt'};
  const html=renderToStaticMarkup(createElement(ResourceStatus,{message:'',progress:error}));
  for(const text of ['地图准备失败','退出码 1','unexpected end of file','vips.exe','资源处理记录.txt','自动重试'])expect(html).toContain(text);
});
it('拒绝非法进度数值',()=>{
  expect(parseProgress({...progress,completed:12})).toBeNull();expect(parseProgress({...progress,elapsedMs:-1})).toBeNull();expect(parseProgress(progress)).toEqual(progress);
});
