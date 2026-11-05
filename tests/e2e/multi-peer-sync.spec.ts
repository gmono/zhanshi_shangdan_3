import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { WebSocket } from 'ws';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';

const host = process.env.E2E_SERVER_IP || '127.0.0.1';
const origin = `http://127.0.0.1:${process.env.E2E_FRONTEND_PORT || '1430'}`;

test('Windows 与两个 iOS 双向触摸、换页、设置及断线重连保持同一状态', async ({ browser, browserName, playwright }, info) => {
  test.setTimeout(240000);
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const diagnostics: { endpoint: string; message: string; expectedDisconnect: boolean }[] = [];
  const messages: { endpoint: string; message: any }[] = [];
  const snapshots: any[] = [];
  const proxyIp = '127.0.0.2';
  const proxyServers: Server[] = [];
  const proxySockets = new Set<Socket>();
  let secondOffline = false;
  let secondRecovering = false;
  // 原样转发真实服务的 TCP 字节；只切断第二个 iOS 的连接，不伪造协议响应。
  const forward = async (port: number) => {
    const server = createServer(client => {
      if (secondOffline) { client.destroy(); return; }
      const upstream = createConnection({ host, port });
      for (const socket of [client, upstream]) {
        proxySockets.add(socket);
        socket.on('close', () => proxySockets.delete(socket));
      }
      client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
      client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
      client.pipe(upstream); upstream.pipe(client);
    });
    proxyServers.push(server);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, proxyIp, resolve); });
  };
  const desktopBrowser = browserName === 'webkit'
    ? await playwright.chromium.launch({ executablePath: process.env.E2E_CHROMIUM_EXECUTABLE }) : browser;
  const observer = new WebSocket(`ws://${host}:8787`);
  observer.on('message', raw => {
    const message = JSON.parse(String(raw));
    if (message.type === 'snapshot' && message.state) snapshots.push(message);
  });
  await new Promise<void>((resolve, reject) => {
    observer.once('error', reject);
    observer.once('open', () => {
      observer.send(JSON.stringify({ id: 1, type: 'hello', role: 'display', room: 'exhibition-main-room' }));
      resolve();
    });
  });
  const state = () => snapshots.at(-1)?.state;
  const settled = async (page: Page) => {
    const outlet = page.locator('ion-router-outlet');
    if (await outlet.count()) await expect.poll(() => outlet.evaluate(element => element.getAnimations({ subtree: true }).some(animation => animation.playState === 'running'))).toBe(false);
  };
  const makePage = async (name: string, width: number, height: number, mobile: boolean, engine: Browser = browser) => {
    const context = await engine.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: mobile });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') diagnostics.push({ endpoint: name, message: message.text(), expectedDisconnect: name === 'iOS-2' && secondRecovering });
    });
    page.on('requestfailed', request => diagnostics.push({ endpoint: name, message: `${request.url()}: ${request.failure()?.errorText}`, expectedDisconnect: name === 'iOS-2' && secondRecovering }));
    page.on('websocket', socket => socket.on('framesent', frame => {
      try { messages.push({ endpoint: name, message: JSON.parse(String(frame.payload)) }); } catch { /* 忽略非应用层帧。 */ }
    }));
    return page;
  };
  const connectIos = async (page: Page, address = host) => {
    await page.goto(`${origin}/?role=controller`);
    await expect(page).toHaveTitle('展厅App');
    await page.getByRole('button', { name: '连接 Windows 大屏', exact: true }).click();
    await page.getByRole('textbox', { name: 'Windows 地址', exact: true }).fill(address);
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect(page.getByText(/已连接 \d+ 块大屏/)).toBeVisible();
    await page.locator('.settings-page').getByRole('button', { name: '返回', exact: true }).click();
    await settled(page);
  };
  const stage = (page: Page, pageId: string) => page.locator(`.map-stage[data-page="${pageId}"]:visible`);
  const splitValues = (page: Page) => stage(page, 'comparison').locator('.split-inner').evaluateAll(elements =>
    elements.map(element => JSON.parse(element.getAttribute('data-splits')!)[0] as number));
  const allSplits = async (pages: Page[], expected: number[]) => {
    for (const page of pages) {
      await expect(stage(page, 'comparison')).toBeVisible();
      await expect.poll(async () => Math.max(...(await splitValues(page)).map((value, index) => Math.abs(value - expected[index])))).toBeLessThan(0.03);
      await expect.poll(async () => (await splitValues(page)).every((value, index) => value === state()?.innerSplits?.[index]?.[0])).toBeTruthy();
    }
  };
  const drag = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (page.context().browser()?.browserType().name() === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      try {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 1 }] });
        for (let step = 1; step <= 12; step++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 12, y: from.y + (to.y - from.y) * step / 12, id: 1 }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally { await cdp.detach(); }
    } else {
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
    }
  };
  const dragSplit = async (page: Page, index: number, ratio: number, heightRatio = 0.2) => {
    await settled(page);
    const panel = stage(page, 'comparison').locator('.split-inner').nth(index);
    const hit = panel.getByRole('slider');
    const line = (await hit.boundingBox())!;
    const bounds = (await panel.boundingBox())!;
    await drag(page, { x: line.x + line.width / 2, y: bounds.y + bounds.height * heightRatio }, { x: bounds.x + bounds.width * ratio, y: bounds.y + bounds.height * heightRatio });
  };
  const painted = async (page: Page, pageId: string) => {
    await expect(stage(page, pageId)).toBeVisible();
    await settled(page);
    await expect.poll(() => stage(page, pageId).locator('canvas').evaluateAll(canvases => canvases.length > 0 && canvases.every(element => {
      const canvas = element as HTMLCanvasElement;
      if (!canvas.width || !canvas.height) return false;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let offset = 0; offset < pixels.length; offset += 64) if (pixels[offset] || pixels[offset + 1] || pixels[offset + 2]) return true;
      return false;
    }))).toBeTruthy();
  };
  const frameHash = (page: Page) => stage(page, 'map-1').locator('canvas').first().evaluate(canvas => {
    const small = document.createElement('canvas'); small.width = 32; small.height = 24;
    const context = small.getContext('2d')!; context.drawImage(canvas as HTMLCanvasElement, 0, 0, 32, 24);
    return Array.from(context.getImageData(0, 0, 32, 24).data).join(',');
  });
  try {
    await Promise.all([forward(8787), forward(1421)]);
    const windows = await makePage('Windows', 1920, 1080, false, desktopBrowser);
    const first = await makePage('iOS-1', 1194, 834, true);
    const second = await makePage('iOS-2', 1366, 1024, true);
    const pages = [windows, first, second];

    await test.step('Windows 可直接触摸，后加入的两个 iOS 不重置状态', async () => {
      await windows.goto(`${origin}/?role=display`);
      await expect(windows).toHaveTitle('展厅App');
      await painted(windows, 'comparison');
      await expect(windows.getByRole('button')).toHaveCount(0);
      await expect(windows.locator('.outer-divider [role="slider"]')).toHaveCount(0);
      await dragSplit(windows, 0, 0.3);
      await allSplits([windows], [0.3, 0, 0]);
      await connectIos(first);
      await allSplits([windows, first], [0.3, 0, 0]);
      await dragSplit(first, 1, 0.6);
      await allSplits([windows, first], [0.3, 0.6, 0]);
      await connectIos(second, proxyIp);
      await allSplits(pages, [0.3, 0.6, 0]);
      await dragSplit(second, 2, 0.75, 0.8);
      await allSplits(pages, [0.3, 0.6, 0.75]);
      await Promise.all([dragSplit(windows, 0, 0.45), dragSplit(first, 1, 0.25)]);
      await allSplits(pages, [0.45, 0.25, 0.75]);
    });

    await test.step('任一 iOS 换页，三端实际画布跟随且无换页回声', async () => {
      const remoteWrites = messages.filter(item => item.endpoint !== 'iOS-1' && item.message.type === 'state').length;
      await first.getByRole('region', { name: '地图操作面板' }).getByRole('button', { name: '图1', exact: true }).click();
      for (const page of pages) await painted(page, 'map-1');
      for (const page of [first, second]) await expect(page).toHaveURL(/\/map\/map-1\?role=controller$/);
      await expect.poll(() => state()?.page).toBe('map-1');
      expect(state().mapViews['map-1']).toEqual({ center: [0.5, 0.5], zoom: 0, space: 'image-relative' });
      expect(messages.filter(item => item.endpoint !== 'iOS-1' && item.message.type === 'state')).toHaveLength(remoteWrites);
    });

    await test.step('Windows 双指缩放和触摸平移同步到两个 iOS 的画布', async () => {
      const before = await Promise.all(pages.map(frameHash));
      const box = (await stage(windows, 'map-1').boundingBox())!;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      if (windows.context().browser()?.browserType().name() === 'chromium') {
        const cdp = await windows.context().newCDPSession(windows);
        try {
          const points = (distance: number) => [{ x: center.x - distance, y: center.y, id: 1 }, { x: center.x + distance, y: center.y, id: 2 }];
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(80) });
          for (let step = 1; step <= 12; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(80 + step * 12) });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally { await cdp.detach(); }
      } else { await stage(windows, 'map-1').locator('.map-target').dblclick(); }
      await expect.poll(() => state()?.mapViews?.['map-1']?.zoom).toBeGreaterThan(0.3);
      for (let index = 0; index < pages.length; index++) await expect.poll(() => frameHash(pages[index])).not.toBe(before[index]);
      const previous = [...state().mapViews['map-1'].center];
      await drag(windows, center, { x: center.x + 160, y: center.y + 70 });
      await expect.poll(() => Math.abs(state().mapViews['map-1'].center[0] - previous[0])).toBeGreaterThan(0.02);
      for (const [index, page] of pages.entries()) await page.screenshot({ path: `tmp/peer-sync-validation-20261105/${info.project.name}-map-${index}.png` });
      await expect(windows.getByRole('button')).toHaveCount(0);
    });

    await test.step('设置页仅影响本机，其他端换页后退出设置跟随共享页', async () => {
      await second.getByRole('button', { name: '打开设置', exact: true }).click();
      await expect(second).toHaveURL(/\/settings/);
      await expect.poll(() => state()?.page).toBe('map-1');
      await first.getByRole('region', { name: '地图操作面板' }).getByRole('button', { name: '返回', exact: true }).click();
      await allSplits([windows, first], [0, 0, 0]);
      await expect(second).toHaveURL(/\/settings/);
      await dragSplit(windows, 0, 0.4);
      await second.locator('.settings-page').getByRole('button', { name: '返回', exact: true }).click();
      await allSplits(pages, [0.4, 0, 0]);
    });

    await test.step('一个 iOS 断网时另外两端继续操作，重连不覆盖现态', async () => {
      secondOffline = true;
      secondRecovering = true;
      await second.context().setOffline(true);
      for (const socket of proxySockets) socket.destroy();
      await expect(second.getByRole('button', { name: '连接 Windows 大屏', exact: true })).toBeVisible({ timeout: 35000 });
      await dragSplit(windows, 0, 0.65);
      await dragSplit(first, 1, 0.35);
      await allSplits([windows, first], [0.65, 0.35, 0]);
      const writes = messages.filter(item => item.endpoint === 'iOS-2' && item.message.type === 'state').length;
      secondOffline = false;
      await second.context().setOffline(false);
      await allSplits(pages, [0.65, 0.35, 0]);
      secondRecovering = false;
      expect(messages.filter(item => item.endpoint === 'iOS-2' && item.message.type === 'state')).toHaveLength(writes);
      await dragSplit(second, 2, 1, 0.8);
      await allSplits(pages, [0.65, 0.35, 1]);
      await dragSplit(second, 2, 0, 0.8);
      await allSplits(pages, [0.65, 0.35, 0]);
      await dragSplit(second, 2, 0.8, 0.8);
      await allSplits(pages, [0.65, 0.35, 0.8]);
      for (const [index, page] of pages.entries()) await page.screenshot({ path: `tmp/peer-sync-validation-20261105/${info.project.name}-comparison-${index}.png` });
      await first.context().close();
      await dragSplit(windows, 0, 0.5);
      await allSplits([windows, second], [0.5, 0.35, 0.8]);
    });
    expect(errors).toEqual([]);
    expect(diagnostics.filter(item => !item.expectedDisconnect)).toEqual([]);
    expect(messages.some(item => item.endpoint === 'Windows' && item.message.type === 'state')).toBeTruthy();
    for (const endpoint of ['iOS-1', 'iOS-2']) expect(messages.some(item => item.endpoint === endpoint && item.message.type === 'state')).toBeTruthy();
  } finally {
    const evidence = JSON.stringify({ browserName, messages, snapshots, errors, diagnostics }, null, 2);
    await mkdir(info.outputDir, { recursive: true });
    const evidencePath = info.outputPath('sync-messages.json');
    await writeFile(evidencePath, evidence);
    await info.attach('三端同步消息与异常', { path: evidencePath, contentType: 'application/json' });
    observer.terminate();
    await Promise.all(contexts.map(context => context.close()));
    for (const socket of proxySockets) socket.destroy();
    await Promise.all(proxyServers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    if (desktopBrowser !== browser) await desktopBrowser.close();
  }
});
