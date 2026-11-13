import { test, expect } from '@playwright/test';

test('Windows展示端整个页面阻止右键菜单，平板端不受影响', async ({ page, browser }) => {
  await page.goto('/?role=display');
  await expect(page.locator('.display-page')).toBeVisible();
  // 覆盖文档、页面及Shadow DOM里的内容，contextmenu同时用于鼠标和触摸长按。
  const cancelled = await page.evaluate(() => {
    const targets: EventTarget[] = [document, document.body, document.querySelector('ion-app')!, document.querySelector('.display-page')!];
    const content = document.querySelector('ion-content')!;
    const shadow = content.shadowRoot?.querySelector('[part="scroll"]');
    if (shadow) targets.push(shadow);
    return targets.map(target => !target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, button: 2 })));
  });
  expect(cancelled.length).toBeGreaterThanOrEqual(4);
  expect(cancelled.every(Boolean)).toBe(true);
  const tablet = await browser.newContext();
  try {
    const controller = await tablet.newPage();
    await controller.goto('/?role=controller');
    await expect(controller.getByRole('button', { name: '退出', exact: true })).toBeVisible();
    expect(await controller.evaluate(() => document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, button: 2 })))).toBe(true);
  } finally { await tablet.close(); }
});
