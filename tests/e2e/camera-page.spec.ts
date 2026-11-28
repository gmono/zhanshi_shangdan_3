import { test, expect, type Browser } from '@playwright/test';

const host = process.env.E2E_SERVER_IP || '127.0.0.1';
const stage = (page: import('@playwright/test').Page) => page.locator('.map-stage[data-page="comparison"]:visible');

async function displayPage(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto('/?role=display');
  return { context, page };
}

test('主页拍照进入相机页并同步，Windows 只显示画面没有控制层', async ({ page, browser }) => {
  test.setTimeout(120000);
  await page.addInitScript(ip => localStorage.setItem('exhibition-connection-v2', JSON.stringify({ ip })), host);
  const display = await displayPage(browser);
  await Promise.all([page.goto('/?role=controller'), display.page.waitForLoadState('domcontentloaded')]);
  // 房间可能停在上一个用例的页面；先通过现有返回入口回到主页。
  if (!(await page.locator('.camera-entry').isVisible().catch(() => false))) {
    if (await page.locator('.camera-back').isVisible().catch(() => false)) await page.locator('.camera-back').click();
    else {
      const back = page.getByRole('region', { name: '地图操作面板' }).getByRole('button', { name: '返回', exact: true });
      if (await back.isVisible().catch(() => false)) await back.click();
    }
  }
  await expect(page.locator('.camera-entry')).toBeVisible();
  await expect(stage(page)).toBeVisible();
  await expect(stage(display.page)).toBeVisible();

  await page.locator('.camera-entry').click();
  await expect(page.locator('.camera-page[data-camera-mode="controller"]')).toBeVisible();
  await expect(display.page.locator('.camera-page[data-camera-mode="display"]')).toBeVisible();
  await expect(page.locator('.camera-controls')).toHaveCount(1);
  await expect(display.page.locator('.camera-controls')).toHaveCount(0);
  await expect(display.page.locator('.camera-page')).toContainText('相机画面');

  await page.getByRole('button', { name: '近焦', exact: true }).click();
  await expect(page.locator('.camera-waiting span')).toContainText('相机控制服务未连接');
  await page.locator('.camera-back').click();
  await expect(page.locator('.camera-entry')).toBeVisible();
  await expect(stage(page)).toBeVisible();
  await expect(stage(display.page)).toBeVisible();
  await display.context.close();
});
