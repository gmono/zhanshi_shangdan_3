import { test, expect, type Page } from '@playwright/test';

const host = process.env.E2E_SERVER_IP || '127.0.0.1';
const stage = (page: Page) => page.locator('.map-stage[data-page="map-1"]:visible');

// 从实际 OpenLayers 画布读取图片可见边界；透明或过暗区域视为黑边。
async function imageBounds(page: Page) {
  return stage(page).locator('.map-target').evaluate(target => {
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
    return { left: left / output.width, right: (right + 1) / output.width, top: top / output.height, bottom: (bottom + 1) / output.height };
  });
}

// 手势仍在进行时读取画布；等待两帧让 OpenLayers 完成本帧渲染，再量黑边。
async function gestureBounds(page: Page, kind: 'drag' | 'zoomIn' | 'zoomOut', dx = 0, dy = 0) {
  return stage(page).locator('.map-target').evaluate(async (target, args) => {
    const viewport = target.querySelector('.ol-viewport') as HTMLElement;
    const frame = viewport.getBoundingClientRect();
    const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
    const send = (type: string, pointerId: number, x: number, y: number, buttons: number, primary: boolean) => viewport.dispatchEvent(new PointerEvent(type, {
      bubbles: true, composed: true, cancelable: true, pointerType: 'touch', pointerId, isPrimary: primary, button: 0, buttons, clientX: x, clientY: y,
    }));
    if (args.kind === 'drag') {
      send('pointerdown', 1, center.x, center.y, 1, true);
      for (let step = 1; step <= 12; step++) send('pointermove', 1, center.x + args.dx * step / 12, center.y + args.dy * step / 12, 1, true);
    } else {
      const from = args.kind === 'zoomIn' ? 60 : 170, to = args.kind === 'zoomIn' ? 180 : 30;
      send('pointerdown', 101, center.x - from, center.y, 1, true);
      send('pointerdown', 102, center.x + from, center.y, 1, false);
      for (let step = 1; step <= 12; step++) {
        const distance = from + (to - from) * step / 12;
        send('pointermove', 101, center.x - distance, center.y, 1, true);
        send('pointermove', 102, center.x + distance, center.y, 1, false);
      }
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
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
    const result = { left: left / output.width, right: (right + 1) / output.width, top: top / output.height, bottom: (bottom + 1) / output.height };
    if (args.kind === 'drag') send('pointerup', 1, center.x + args.dx, center.y + args.dy, 0, true);
    else { send('pointerup', 101, center.x - 30, center.y, 0, true); send('pointerup', 102, center.x + 30, center.y, 0, false); }
    return result;
  }, { kind, dx, dy });
}

const covers = (bounds: { left: number; right: number; top: number; bottom: number }) =>
  bounds.left <= 0.006 && bounds.right >= 0.994 && bounds.top <= 0.006 && bounds.bottom >= 0.994;

test('单图最小缩放和四边拖动过程中都不露出黑边', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.goto('/?role=controller');
  if (await page.getByRole('button', { name: '连接 Windows 大屏' }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '连接 Windows 大屏' }).click();
    await page.getByRole('textbox', { name: 'Windows 地址', exact: true }).fill(host);
    await page.getByRole('button', { name: '保存连接', exact: true }).click();
    await expect(page.getByText(/已连接 \d+ 块大屏/)).toBeVisible();
    await page.locator('.settings-page').getByRole('button', { name: '返回', exact: true }).click();
  }
  const panel = page.getByRole('region', { name: '地图操作面板' });
  await panel.getByRole('button', { name: '图1', exact: true }).click();
  await expect(stage(page)).toBeVisible();
  await expect(stage(page).locator('canvas')).toHaveCount(1);
  await page.waitForLoadState('networkidle');

  const size = page.viewportSize()!;
  const scale = Math.min(size.width / 1600, size.height / 1000);
  const contain = { left: (size.width - 1600 * scale) / 2 / size.width, right: (size.width + 1600 * scale) / 2 / size.width, top: (size.height - 1000 * scale) / 2 / size.height, bottom: (size.height + 1000 * scale) / 2 / size.height };
  await expect.poll(async () => {
    const bounds = await imageBounds(page);
    return Math.max(Math.abs(bounds.left - contain.left), Math.abs(bounds.top - contain.top), Math.abs(bounds.right - contain.right), Math.abs(bounds.bottom - contain.bottom));
  }).toBeLessThan(0.012);
  const initial = await imageBounds(page);

  // 完整显示时拖动：旧实现只锁中心，会把图片拖出画布，露出黑边。
  for (const [dx, dy] of [[320, 0], [-320, 0], [0, 260], [0, -260]]) {
    const bounds = await gestureBounds(page, 'drag', dx, dy);
    expect(Math.max(Math.abs(bounds.left - initial.left), Math.abs(bounds.right - initial.right), Math.abs(bounds.top - initial.top), Math.abs(bounds.bottom - initial.bottom))).toBeLessThan(0.012);
    await page.waitForTimeout(350);
  }

  // 放大到覆盖整个画布后，向四边各拖一次，过程中图片边缘不能离开画布。
  await gestureBounds(page, 'zoomIn');
  await page.waitForTimeout(350);
  expect(covers(await imageBounds(page))).toBe(true);
  for (const [dx, dy] of [[700, 0], [-700, 0], [0, 600], [0, -600]]) {
    const bounds = await gestureBounds(page, 'drag', dx, dy);
    expect(covers(bounds)).toBe(true);
    await page.waitForTimeout(350);
  }

  // 双指向内缩放到超过完整显示：过程中旧实现会短暂缩小图片、放大黑边。
  const zoomedOut = await gestureBounds(page, 'zoomOut');
  expect(Math.max(Math.abs(zoomedOut.left - initial.left), Math.abs(zoomedOut.right - initial.right), Math.abs(zoomedOut.top - initial.top), Math.abs(zoomedOut.bottom - initial.bottom))).toBeLessThan(0.012);
  await page.waitForTimeout(350);
  const settled = await imageBounds(page);
  expect(Math.max(Math.abs(settled.left - initial.left), Math.abs(settled.right - initial.right), Math.abs(settled.top - initial.top), Math.abs(settled.bottom - initial.bottom))).toBeLessThan(0.012);

  await panel.getByRole('button', { name: '返回', exact: true }).click();
  await expect.poll(() => page.locator('.map-stage[data-page="comparison"]:visible').count()).toBe(1);
});
