// Без сессии cabinet.html обязан вести на /login.html.
// Это критический guard — закрывает дыру, через которую раньше ?p=slug пускал любого.
import { test, expect } from '@playwright/test';
import { setupApi } from './helpers/mock-api.js';

test.describe('Cabinet — session guard', () => {

  test('без сессии редирект на /login.html', async ({ page }) => {
    await setupApi(page);  // /api/auth/me → authenticated: false
    await page.goto('/cabinet.html');
    await page.waitForURL(/\/login\.html/);
    await expect(page.locator('h1')).toContainText('Вход в кабинет');
  });

  test('demo-режим даёт доступ без сессии', async ({ page }) => {
    await setupApi(page);
    await page.goto('/cabinet.html?demo=1');
    // Не должен редиректить
    await expect(page).toHaveURL(/cabinet\.html/);
    // Сразу видим имя партнёра-демо
    await expect(page.locator('#cab-partner-name')).toContainText('Зубарик');
    // 4 stat-карточки
    await expect(page.locator('.stat-card')).toHaveCount(4);
  });

  test('logout вызывает API и редиректит на login', async ({ page }) => {
    let logoutHit = false;
    await setupApi(page, {
      '/api/auth/me': (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            authenticated: true,
            partner_slug: 'stomat_chln_01',
            partner: { name: 'Зубарик', city: 'Челны', tier: 'silver', slug: 'stomat_chln_01' }
          })
        }),
      '/api/auth/logout': (route) => {
        logoutHit = true;
        return route.fulfill({ status: 200, body: '{"ok":true}' });
      }
    });

    await page.goto('/cabinet.html');
    await expect(page.locator('#cab-partner-name')).toBeVisible();
    await page.click('#btn-logout');
    await page.waitForURL(/\/login\.html/);
    expect(logoutHit).toBe(true);
  });
});
