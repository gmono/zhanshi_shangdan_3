import {test,expect} from '@playwright/test';

test('Windows 展示端进度面板铺满窗口，详细错误及断线状态可见',async({page})=>{
  let disconnected=false;
  let progress={phase:'processing',completed:3,total:11,elapsedMs:12500,message:'正在解码原图并生成显示瓦片',currentFile:'图1.jpg',sourcePath:'C:\\展厅App\\地图资源\\图1.jpg',processorPath:'C:\\展厅App\\tools\\vips.exe',error:''};
  await page.route('http://127.0.0.1:1421/catalog',async route=>{
    if(disconnected){await route.abort('failed');return;}
    await route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({message:progress.message,progress})});
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
  await expect(page.getByRole('heading',{name:'地图准备失败'})).toBeVisible();
  await expect(page.locator('.resource-error')).toContainText('unexpected end of file');
  await expect(page.locator('.resource-error')).toContainText('exit code 1');
  await page.screenshot({path:`tmp/e2e/${test.info().project.name}-processing-error.png`});
  disconnected=true;
  await expect(page.locator('.resource-error')).toContainText('http://127.0.0.1:1421/catalog');
  await expect(page.getByText('无法读取 Windows 地图处理状态，正在重连')).toBeVisible();
});
