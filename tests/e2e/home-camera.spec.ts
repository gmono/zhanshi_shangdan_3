import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { WebSocket } from 'ws';

const host = process.env.E2E_SERVER_IP || '127.0.0.1';
const origin = `http://127.0.0.1:${process.env.E2E_FRONTEND_PORT || '1430'}`;
const stage = (page: Page) => page.locator('.map-stage[data-page="comparison"]:visible');
const place = (page: Page, index: number) => stage(page).locator('.split-inner').nth(index);

async function settled(page: Page) {
  const outlet = page.locator('ion-router-outlet');
  if (await outlet.count()) await expect.poll(() => outlet.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'))).toBe(false);
}

async function hashes(page: Page) {
  return stage(page).locator('canvas').evaluateAll(canvases => canvases.map(canvas => {
    const sample = document.createElement('canvas'); sample.width = 32; sample.height = 24;
    const context = sample.getContext('2d')!;
    context.drawImage(canvas, 0, 0, 32, 24);
    return Array.from(context.getImageData(0, 0, 32, 24).data).join(',');
  }));
}

async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  if (page.context().browser()?.browserType().name() === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
      for (let step = 1; step <= 10; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 10, y: from.y + (to.y - from.y) * step / 10, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await cdp.detach(); }
  } else {
    // WebKit 没有 CDP 触摸注入接口；拖动使用浏览器鼠标，双指用标准 PointerEvent。
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up();
  }
}

async function pinch(page: Page, index: number) {
  const box = (await place(page, index).boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // 两指分处图片分割线两侧，实际命中必须属于同一个整块地点触摸目标。
  expect(await page.evaluate(({ x, y }) => {
    const first = document.elementFromPoint(x - 55, y)?.closest('.map-surface');
    const second = document.elementFromPoint(x + 55, y)?.closest('.map-surface');
    return !!first && first === second && first.parentElement?.classList.contains('split-inner');
  }, center)).toBe(true);
  if (page.context().browser()?.browserType().name() === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    try {
      const points = (distance: number) => [{ x: center.x - distance, y: center.y, id: 1 }, { x: center.x + distance, y: center.y, id: 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(55) });
      for (let step = 1; step <= 10; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(55 + step * 5) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await cdp.detach(); }
  } else {
    await page.evaluate(center => {
      const targets = [document.elementFromPoint(center.x - 55, center.y)!, document.elementFromPoint(center.x + 55, center.y)!];
      const send = (type: string, index: number, distance: number, buttons: number) => targets[index].dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerType: 'touch', pointerId: 101 + index, isPrimary: index === 0, button: 0, buttons, clientX: center.x + (index ? distance : -distance), clientY: center.y }));
      send('pointerdown', 0, 55, 1); send('pointerdown', 1, 55, 1);
      for (let step = 1; step <= 10; step++) { send('pointermove', 0, 55 + step * 5, 1); send('pointermove', 1, 55 + step * 5, 1); }
      send('pointerup', 0, 105, 0); send('pointerup', 1, 105, 0);
    }, center);
  }
}

test('主页三地点分别双指缩放和平移、整线拖动，Windows 与两个 iOS 合并同步并在重连后保留', async ({ browser, browserName, playwright }, info) => {
  test.setTimeout(240000);
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const snapshots: any[] = [];
  const desktop = browserName === 'webkit' ? await playwright.chromium.launch({ executablePath: process.env.E2E_CHROMIUM_EXECUTABLE }) : browser;
  const observer = new WebSocket(`ws://${host}:8787`);
  observer.on('message', raw => { const message = JSON.parse(String(raw)); if (message.type === 'snapshot' && message.state) snapshots.push(message); });
  await new Promise<void>((resolve, reject) => {
    observer.once('error', reject);
    observer.once('open', () => { observer.send(JSON.stringify({ id: 1, type: 'hello', role: 'display', room: 'exhibition-main-room' })); resolve(); });
  });
  const state = () => snapshots.at(-1)?.state;
  const camerasSettled = async () => {
    let previous = '', stable = 0;
    await expect.poll(() => {
      const current = JSON.stringify(state()?.comparisonViews);
      stable = current === previous ? stable + 1 : 0;
      previous = current;
      return stable;
    }, { intervals: [100] }).toBeGreaterThanOrEqual(3);
  };
  const makePage = async (width: number, height: number, mobile: boolean) => {
    const context = await (mobile ? browser : desktop).newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: true });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    if (mobile) await context.addInitScript(ip => localStorage.setItem('exhibition-connection-v2', JSON.stringify({ ip })), host);
    await page.goto(`${origin}/?role=${mobile ? 'controller' : 'display'}`);
    return page;
  };
  try {
    const windows = await makePage(1920, 1080, false);
    const first = await makePage(1194, 834, true);
    const second = await makePage(1366, 1024, true);
    const pages = [windows, first, second];
    for (const page of pages) { await expect(page).toHaveTitle('展厅App'); await expect(stage(page)).toBeVisible(); await expect(stage(page).locator('canvas')).toHaveCount(6); await page.waitForLoadState('networkidle'); }
    // 通过正式导航复位，避免前一个用例的房间状态影响此用例。
    const controls = first.getByRole('region', { name: '地图操作面板' });
    await controls.getByRole('button', { name: '图1', exact: true }).click();
    await expect(first.locator('.map-stage[data-page="map-1"]:visible')).toBeVisible();
    await controls.getByRole('button', { name: '返回', exact: true }).click();
    await expect.poll(() => state()?.page).toBe('comparison');
    for (const page of pages) await settled(page);
    for (let index = 0; index < 3; index++) {
      const bounds = (await place(first, index).boundingBox())!;
      const line = (await place(first, index).getByRole('slider').boundingBox())!;
      expect(await first.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[role="slider"]'), { x: line.x + line.width / 2, y: bounds.y + bounds.height * 0.2 })).toBe(true);
      await touchDrag(first, { x: line.x + line.width / 2, y: bounds.y + bounds.height * 0.2 }, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height * 0.2 });
      await expect.poll(() => state()?.innerSplits[index][0]).toBeCloseTo(0.5, 1);
    }
    await expect(windows.getByRole('button')).toHaveCount(0);
    const initial = await Promise.all(pages.map(hashes));
    await pinch(first, 0);
    await expect.poll(() => state()?.comparisonViews?.['place-1']?.zoom ?? 0).toBeGreaterThan(0.5);
    expect(state().comparisonViews['place-2']).toBeUndefined();
    expect(state().comparisonViews['place-3']).toBeUndefined();
    for (const [pageIndex, page] of pages.entries()) {
      await expect.poll(async () => { const current = await hashes(page); return current[0] !== initial[pageIndex][0] && current[1] !== initial[pageIndex][1]; }).toBe(true);
      expect((await hashes(page)).slice(2)).toEqual(initial[pageIndex].slice(2));
    }
    const beforePan = [...state().comparisonViews['place-1'].center];
    const box = (await place(first, 0).boundingBox())!;
    await touchDrag(first, { x: box.x + box.width * 0.25, y: box.y + box.height * 0.65 }, { x: box.x + box.width * 0.25 + 35, y: box.y + box.height * 0.65 - 70 });
    await expect.poll(() => Math.max(...state().comparisonViews['place-1'].center.map((n: number, i: number) => Math.abs(n - beforePan[i])))).toBeGreaterThan(0.01);
    await camerasSettled();
    const preserved = structuredClone(state().comparisonViews['place-1']);
    // 两个其他端同时操作不同地点，服务器合并后应保留三组相机。
    await Promise.all([pinch(windows, 1), pinch(second, 2)]);
    await expect.poll(() => state()?.comparisonViews?.['place-2']?.zoom ?? 0).toBeGreaterThan(0.5);
    await expect.poll(() => state()?.comparisonViews?.['place-3']?.zoom ?? 0).toBeGreaterThan(0.5);
    await camerasSettled();
    expect(state().comparisonViews['place-1']).toEqual(preserved);
    const cameras = structuredClone(state().comparisonViews);
    // 整条分割线在上、下两处都可拖到边界，且不改变相机。
    for (const [ratio, yRatio] of [[1, 0.15], [0, 0.8], [0.5, 0.3]]) {
      const bounds = (await place(windows, 1).boundingBox())!;
      const line = (await place(windows, 1).getByRole('slider').boundingBox())!;
      await touchDrag(windows, { x: line.x + line.width / 2, y: bounds.y + bounds.height * yRatio }, { x: bounds.x + bounds.width * ratio, y: bounds.y + bounds.height * yRatio });
      await expect.poll(() => state().innerSplits[1][0]).toBeCloseTo(ratio, 2);
    }
    expect(state().comparisonViews).toEqual(cameras);
    await second.reload();
    await expect(stage(second)).toBeVisible(); await expect(stage(second).locator('canvas')).toHaveCount(6);
    await second.waitForLoadState('networkidle');
    expect(state().comparisonViews).toEqual(cameras);
    for (const [index, page] of pages.entries()) await page.screenshot({ path: info.outputPath(`主页独立视角-${index}.png`) });
    await controls.getByRole('button', { name: '图1', exact: true }).click();
    await expect(first.locator('.map-stage[data-page="map-1"]:visible')).toBeVisible();
    await controls.getByRole('button', { name: '返回', exact: true }).click();
    await expect.poll(() => state()?.page).toBe('comparison');
    expect(state().comparisonViews).toEqual({});
    expect(state().innerSplits).toEqual([[0], [0], [0]]);
    expect(errors).toEqual([]);
  } finally {
    await info.attach('主页视角状态与页面异常', { body: JSON.stringify({ snapshots, errors }, null, 2), contentType: 'application/json' });
    observer.terminate();
    await Promise.all(contexts.map(context => context.close()));
    if (desktop !== browser) await desktop.close();
  }
});
