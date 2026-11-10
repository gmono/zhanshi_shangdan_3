import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';

const host = process.env.E2E_SERVER_IP || '127.0.0.1';
const initial = { center: [0.5, 0.5], zoom: 0, space: 'image-relative' };

test('平板浮动按钮恢复当前页视角并同步，保留分割线，Windows无复位按钮', async ({ page, browser }, info) => {
  const states: any[] = [];
  const errors: string[] = [];
  const observer = new WebSocket(`ws://${host}:8787`);
  observer.on('message', raw => { const message = JSON.parse(String(raw)); if (message.type === 'snapshot' && message.state) states.push(message.state); });
  await new Promise<void>((resolve, reject) => { observer.once('error', reject); observer.once('open', () => { observer.send(JSON.stringify({ id: 1, type: 'hello', role: 'display', room: 'exhibition-main-room' })); resolve(); }); });
  const displayContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const display = await displayContext.newPage();
  const state = () => states.at(-1);
  const reset = page.getByRole('button', { name: '恢复初始视角', exact: true });
  page.on('pageerror', error => errors.push(error.message));
  display.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(ip => localStorage.setItem('exhibition-connection-v2', JSON.stringify({ ip })), host);
  try {
    await page.goto('/?role=controller'); await display.goto('/?role=display');
    // 与其他用例共用真实房间，正式导航回主页准备本用例，不改服务器状态。
    await page.getByRole('button', { name: '图1', exact: true }).click();
    await expect(page.locator('.map-stage[data-page="map-1"]:visible')).toBeVisible();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page.locator('.map-stage[data-page="comparison"]:visible')).toBeVisible();
    await expect.poll(() => page.locator('ion-router-outlet').evaluate(outlet => outlet.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'))).toBe(false);
    await expect(reset).toHaveCount(0);
    const divider = page.getByRole('slider').first();
    await divider.focus(); for (let step = 0; step < 10; step++) await divider.press('ArrowRight');
    // 等待16ms合并窗口中的最终值，不能将中间快照当作停止后的状态。
    await expect.poll(() => state()?.innerSplits[0][0]).toBeCloseTo(0.2, 6);
    const splits = structuredClone(state().innerSplits);
    const target = page.locator('.map-stage[data-page="comparison"]:visible .split-inner').first().locator(':scope > .map-surface .ol-viewport');
    await target.evaluate(viewport => {
      const box = viewport.getBoundingClientRect(); const x = box.x + box.width * 0.65, y = box.y + box.height * 0.5;
      const send = (type: string, id: number, distance: number, buttons: number) => viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 101, clientX: x + (id === 101 ? -distance : distance), clientY: y, button: 0, buttons }));
      send('pointerdown', 101, 35, 1); send('pointerdown', 102, 35, 1);
      for (let step = 1; step <= 10; step++) { send('pointermove', 101, 35 + step * 4, 1); send('pointermove', 102, 35 + step * 4, 1); }
      send('pointerup', 101, 75, 0); send('pointerup', 102, 75, 0);
    });
    await expect.poll(() => state()?.comparisonViews?.['place-1']?.zoom ?? 0).toBeGreaterThan(0.3);
    await expect(reset).toBeVisible({ timeout: 5000 });
    await expect(page.locator('ion-fab-button[aria-label="恢复初始视角"]')).toHaveCount(1);
    await expect(display.getByRole('button')).toHaveCount(0);
    await expect(async () => { await page.screenshot({ path: info.outputPath('主页缩放后复位按钮.png') }); }).toPass({ timeout: 10000 });
    await reset.click();
    await expect.poll(() => state()?.comparisonViews?.['place-1']).toEqual(initial);
    expect(state().innerSplits).toEqual(splits);
    await expect(reset).toHaveCount(0);
    await expect(display.getByRole('button')).toHaveCount(0);
    await page.getByRole('button', { name: '图1', exact: true }).click();
    const map = page.locator('.map-stage[data-page="map-1"]:visible .ol-viewport');
    await expect(map).toBeVisible();
    await expect(reset).toHaveCount(0);
    // 单图沿用标准OpenLayers双指处理，测试注入相同PointerEvent序列。
    await map.evaluate(viewport => {
      const box = viewport.getBoundingClientRect(); const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const send = (type: string, id: number, distance: number, buttons: number) => viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 201, clientX: x + (id === 201 ? -distance : distance), clientY: y, button: 0, buttons }));
      send('pointerdown', 201, 50, 1); send('pointerdown', 202, 50, 1);
      for (let step = 1; step <= 10; step++) { send('pointermove', 201, 50 + step * 8, 1); send('pointermove', 202, 50 + step * 8, 1); }
      send('pointerup', 201, 130, 0); send('pointerup', 202, 130, 0);
    });
    await expect.poll(() => state()?.mapViews?.['map-1']?.zoom ?? 0).toBeGreaterThan(0.3);
    await expect(reset).toBeVisible();
    await expect(async () => { await page.screenshot({ path: info.outputPath('单图缩放后复位按钮.png') }); }).toPass({ timeout: 10000 });
    await reset.click();
    await expect.poll(() => state()?.mapViews?.['map-1']).toEqual(initial);
    await expect(reset).toHaveCount(0);
    await expect(display.getByRole('button')).toHaveCount(0);
    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    await expect(page.locator('.settings-page:visible')).toBeVisible();
    await expect(reset).toHaveCount(0);
    // 共享房间留在主页，让后续既有用例从相同基线开始。
    await page.locator('.settings-page:visible').getByRole('button', { name: '返回', exact: true }).click();
    await expect(page.locator('.map-stage[data-page="map-1"]:visible')).toBeVisible();
    await page.getByRole('region', { name: '地图操作面板' }).getByRole('button', { name: '返回', exact: true }).click();
    await expect.poll(() => state()?.page).toBe('comparison');
    expect(errors).toEqual([]);
  } finally {
    await info.attach('复位同步状态与异常', { body: JSON.stringify({ states, errors }, null, 2), contentType: 'application/json' });
    observer.terminate(); await displayContext.close();
  }
});
