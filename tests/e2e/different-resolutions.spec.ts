import { test, expect, type Page } from '@playwright/test';
import { WebSocket } from 'ws';
const host = process.env.E2E_SERVER_IP || '127.0.0.1';

// 从实际 OpenLayers 画布读取图片的可见边界，不能只用容器尺寸代替图片已适配。
async function imageBounds(page: Page) {
  return page.locator('.map-stage[data-page="map-1"] .map-target').evaluate(target => {
    const frame = target.getBoundingClientRect();
    const output = document.createElement('canvas');
    output.width = 240; output.height = Math.round(240 * frame.height / frame.width);
    const context = output.getContext('2d')!;
    for (const canvas of target.querySelectorAll('canvas')) {
      const box = canvas.getBoundingClientRect();
      if (canvas.width && canvas.height) context.drawImage(canvas, (box.x - frame.x) / frame.width * output.width, (box.y - frame.y) / frame.height * output.height, box.width / frame.width * output.width, box.height / frame.height * output.height);
    }
    const data = context.getImageData(0, 0, output.width, output.height).data;
    let left = output.width, right = -1, top = output.height, bottom = -1;
    for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
      const offset = (y * output.width + x) * 4;
      if (data[offset + 3] > 100 && Math.max(data[offset], data[offset + 1], data[offset + 2]) > 20) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    return { width: (right - left + 1) / output.width, height: (bottom - top + 1) / output.height, frame: { width: frame.width, height: frame.height } };
  });
}

for (const pair of [
  { controller: { width: 1194, height: 834 }, display: { width: 3840, height: 2160 } },
  { controller: { width: 1024, height: 1366 }, display: { width: 1920, height: 1080 } },
]) {
  test(`两端不同分辨率 ${pair.controller.width}×${pair.controller.height} → ${pair.display.width}×${pair.display.height}，图片按本机尺寸适配且返回主页复位`, async ({ page, browser }, info) => {
    test.setTimeout(180000);
    await page.setViewportSize(pair.controller);
    const displayContext = await browser.newContext({ viewport: pair.display, deviceScaleFactor: 1 });
    const display = await displayContext.newPage();
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message)); display.on('pageerror', e => errors.push(e.message));
    const states: any[] = [];
    const observer = new WebSocket(`ws://${host}:8787`);
    observer.on('message', raw => { const message = JSON.parse(String(raw)); if (message.type === 'snapshot' && message.state) states.push(message.state); });
    await new Promise<void>((resolve, reject) => { observer.once('open', () => { observer.send(JSON.stringify({ id: 1, type: 'hello', role: 'display', room: 'exhibition-main-room' })); resolve(); }); observer.once('error', reject); });
    try {
      await display.goto('/?role=display');
      await page.goto('/?role=controller');
      await page.getByRole('button', { name: '连接 Windows 大屏' }).click();
      await page.getByRole('textbox', { name: 'Windows 地址', exact: true }).fill(host);
      await page.getByRole('button', { name: '保存连接', exact: true }).click();
      await expect(page.getByText(/已连接 \d+ 块大屏/)).toBeVisible();
      await page.locator('.settings-page').getByRole('button', { name: '返回', exact: true }).click();
      const panel = page.getByRole('region', { name: '地图操作面板' });
      const firstDivider = page.getByRole('slider').first();
      await firstDivider.focus();
      for (let step = 0; step < 10; step++) await firstDivider.press('ArrowRight');
      await expect.poll(() => states.at(-1)?.innerSplits[0][0]).toBeGreaterThan(0.1);
      const enterStart = states.length;
      await panel.getByRole('button', { name: '图1', exact: true }).click();
      await expect.poll(() => states.at(-1)?.page).toBe('map-1');
      const entry = states.slice(enterStart).find(state => state.page === 'map-1');
      expect(entry.mapViews['map-1']).toEqual({ center: [0.5, 0.5], zoom: 0, space: 'image-relative' });
      for (const [endpoint, size] of [[page, pair.controller], [display, pair.display]] as const) {
        await expect(endpoint.locator('.map-stage[data-page="map-1"] canvas')).toHaveCount(1);
        const scale = Math.min(size.width / 1600, size.height / 1000);
        const expectedWidth = 1600 * scale / size.width, expectedHeight = 1000 * scale / size.height;
        await expect.poll(async () => {
          const bounds = await imageBounds(endpoint);
          return Math.max(Math.abs(bounds.width - expectedWidth), Math.abs(bounds.height - expectedHeight));
        }).toBeLessThan(0.03);
      }
      await page.screenshot({ path: `tmp/e2e/${info.project.name}-${pair.display.width}-controller.png` });
      await display.screenshot({ path: `tmp/e2e/${info.project.name}-${pair.display.width}-display.png` });
      const target = page.locator('.map-stage[data-page="map-1"] .map-target');
      await target.dblclick();
      await expect.poll(() => states.at(-1)?.mapViews['map-1'].zoom).toBeGreaterThan(0.5);
      const bounds = (await target.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 100, bounds.y + bounds.height / 2 + 50, { steps: 10 }); await page.mouse.up();
      await expect.poll(() => {
        const center = states.at(-1)?.mapViews['map-1'].center;
        return center && (Math.abs(center[0] - 0.5) > 0.01 || Math.abs(center[1] - 0.5) > 0.01);
      }).toBeTruthy();
      const homeStart = states.length;
      await panel.getByRole('button', { name: '返回', exact: true }).click();
      await expect.poll(() => states.at(-1)?.page).toBe('comparison');
      const home = states.slice(homeStart).find(state => state.page === 'comparison');
      expect(home.innerSplits).toEqual([[0], [0], [0]]);
      expect(home.outerSplits).toEqual([1 / 3, 2 / 3]);
      expect(home.mapViews).toEqual({});
      for (const endpoint of [page, display]) {
        const stage = endpoint.locator('.map-stage[data-page="comparison"]');
        await expect(stage).toBeVisible();
        await expect.poll(() => stage.locator('.split-inner').evaluateAll(nodes => nodes.map(node => JSON.parse(node.getAttribute('data-splits')!)))).toEqual([[0], [0], [0]]);
        const widths = await stage.locator('.split-outer > .split-panel').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
      }
      expect(errors).toEqual([]);
    } finally {
      await info.attach('两端分辨率与同步状态', { body: JSON.stringify({ pair, states, errors }, null, 2), contentType: 'application/json' });
      observer.terminate(); await displayContext.close();
    }
  });
}
