import { test, expect } from '@playwright/test';

test('平板主页退出须明确确认，取消和遮罩不退出，关闭失败可重试', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as any;
    target.isTauri = true;
    target.__TAURI_OS_PLUGIN_INTERNALS__ = { os_type: 'ios' };
    target.__exitCalls = 0;
    target.__exitShouldFail = false;
    target.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      invoke: async (command: string) => {
        if (command === 'plugin:os|type') return 'ios';
        if (command === 'exit_tablet') {
          target.__exitCalls++;
          if (target.__exitShouldFail) throw Error('测试关闭失败');
        }
      },
    };
  });
  await page.goto('/?role=controller');
  const exit = page.getByRole('button', { name: '退出', exact: true });
  await expect(exit).toBeVisible({ timeout: 5000 });
  const bounds = (await exit.boundingBox())!;
  const size = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThan(size.width / 2);
  expect(bounds.y).toBeGreaterThan(size.height / 2);
  const calls = () => page.evaluate(() => (window as any).__exitCalls);
  await exit.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  expect(await calls()).toBe(0);
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  expect(await calls()).toBe(0);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await calls()).toBe(0);
  await expect(exit).toBeEnabled();
  await exit.click();
  await dialog.getByRole('button', { name: '确认退出', exact: true }).click();
  await expect.poll(calls).toBe(1);
  await expect(exit).toBeDisabled();
});

test('退出失败可重试，Windows没有退出入口', async ({ page, browser }) => {
  await page.addInitScript(() => {
    const target = window as any;
    target.isTauri = true;
    target.__TAURI_OS_PLUGIN_INTERNALS__ = { os_type: 'ios' };
    target.__exitCalls = 0;
    target.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      invoke: async (command: string) => {
        if (command === 'plugin:os|type') return 'ios';
        if (command === 'exit_tablet') { target.__exitCalls++; throw Error('测试关闭失败'); }
      },
    };
  });
  await page.goto('/?role=controller');
  const exit = page.getByRole('button', { name: '退出', exact: true });
  await exit.click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认退出', exact: true }).click();
  const failure = page.getByRole('alertdialog');
  await expect(failure).toContainText('无法退出');
  await expect(failure).toContainText('测试关闭失败');
  await failure.getByRole('button', { name: '好', exact: true }).click();
  await expect(exit).toBeEnabled();
  await exit.click();
  await page.getByRole('alertdialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__exitCalls)).toBe(1);
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await expect(page.locator('.settings-page:visible')).toBeVisible();
  await expect(exit).toHaveCount(0);
  const tablet = await browser.newContext();
  try {
    const controller = await tablet.newPage();
    await controller.goto('/?role=display');
    await expect(controller.locator('.display-page')).toBeVisible();
    await expect(controller.getByRole('button', { name: '退出', exact: true })).toHaveCount(0);
  } finally { await tablet.close(); }
});

test('退出入口只在主页，进入大图和设置页隐藏，返回主页恢复', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('exhibition-connection-v2', JSON.stringify({ ip: '127.0.0.1' })));
  await page.goto('/?role=controller');
  const exit = page.getByRole('button', { name: '退出', exact: true });
  const controls = page.getByRole('region', { name: '地图操作面板' });
  // 共享房间可能停在上个用例页面，先通过正式返回按钮恢复主页。
  await expect(page.locator('.map-stage:visible')).toBeVisible();
  if (await controls.getByRole('button', { name: '返回', exact: true }).count()) {
    await controls.getByRole('button', { name: '返回', exact: true }).click();
  }
  await expect(exit).toBeVisible();
  const exitBox = (await exit.boundingBox())!;
  const controlsBox = (await controls.boundingBox())!;
  expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(exitBox.x - 8);
  await controls.getByRole('button', { name: '图1', exact: true }).click();
  await expect(page.locator('.map-stage[data-page="map-1"]:visible')).toBeVisible();
  await expect(exit).toHaveCount(0);
  await controls.getByRole('button', { name: '返回', exact: true }).click();
  await expect(exit).toBeVisible();
  await controls.getByRole('button', { name: '打开设置', exact: true }).click();
  await expect(page.locator('.settings-page:visible')).toBeVisible();
  await expect(exit).toHaveCount(0);
  await page.locator('.settings-page:visible').getByRole('button', { name: '返回', exact: true }).click();
  await expect(exit).toBeVisible();
  await exit.click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认退出', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('网页预览无法关闭系统应用');
  await page.getByRole('alertdialog').getByRole('button', { name: '好', exact: true }).click();
  await expect(exit).toBeEnabled();
});
