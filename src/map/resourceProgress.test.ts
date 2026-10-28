// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { ResourceStatus } from './ResourceStatus';
import { parseProgress, delay } from './resourceProgress';

const progress={phase:'processing',completed:3,total:11,elapsedMs:2400,currentFile:'图1.jpg',sourcePath:'C:\\地图资源\\图1.jpg',message:'正在切片'};
it('delay(0) 将运行权交还事件循环',async()=>{
  let finished=false;const task=delay(0).then(()=>{finished=true;});
  expect(finished).toBe(false);await task;expect(finished).toBe(true);
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
it('未统计数量时也接收缺少原图的详细错误，不把零总数误判成坏消息',()=>{
  const error={phase:'error',completed:0,total:0,elapsedMs:0,message:'地图准备失败',error:'缺少原始图片：C:\\展厅App\\地图资源\\左屏 中的图片 1',sourcePath:'C:\\展厅App\\地图资源'};
  expect(parseProgress(error)).toEqual(error);
  const html=renderToStaticMarkup(createElement(ResourceStatus,{message:'',progress:error}));
  expect(html).toContain('地图准备失败');expect(html).toContain(error.error);
  expect(html).not.toContain('NaN');expect(html).not.toContain('Infinity');expect(html).not.toContain('<progress');
  expect(parseProgress({...error,total:-1})).toBeNull();
  expect(parseProgress({...error,phase:'ready'})).toBeNull();
});
