// Login: ошибочные пути + успешный вход.
import { test, expect } from '@playwright/test';
import { setupApi } from './helpers/mock-api.js';

test.describe('Login flow', () => {

  test('пустой slug → inline-ошибка', async ({ page }) => {
    await setupApi(page);
    await page.goto('/login.html');
    await page.click('#btn-request');
    await expect(page.locator('#err-slug')).toBeVisible();
    await expect(page.locator('#err-slug')).toContainText('slug');
  });

  test('not_linked → подсказка про /start в боте', async ({ page }) => {
    await setupApi(page, {
      '/api/auth/request-code': (route) =>
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'not_linked',
            message: 'Сначала привяжите Telegram: напишите боту @Kiber_partner_bot команду /start ghost'
          })
        })
    });

    await page.goto('/login.html');
    await page.fill('#slug-input', 'ghost');
    await page.click('#btn-request');
    await expect(page.locator('#err-slug')).toBeVisible();
    await expect(page.locator('#err-slug')).toContainText('Telegram');
    await expect(page.locator('#err-slug')).toContainText('@Kiber_partner_bot');
  });

  test('happy path: slug → код → переход в кабинет', async ({ page }) => {
    // После verify cabinet.html сам проверяет /api/auth/me. Мокаем как авторизованного.
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
        })
    });
    await page.goto('/login.html');
    await page.fill('#slug-input', 'stomat_chln_01');
    await page.click('#btn-request');
    // Перешли на шаг 2
    await expect(page.locator('#step-slug')).toBeHidden();
    await expect(page.locator('#step-code')).toBeVisible();
    await expect(page.locator('#tg-target')).toContainText('@kiber_test');

    // (Маску буквы→цифры здесь не проверяем: maxlength=6 в браузере обрезает
    // строку до того, как сработает наш input-handler. Маска покрыта юнитом.)
    await page.fill('#code-input', '123456');
    await expect(page.locator('#code-input')).toHaveValue('123456');

    await page.click('#btn-verify');
    // После успешного verify фронт делает window.location.href = '/cabinet.html'
    await page.waitForURL(/\/cabinet\.html/);
  });

  test('wrong_code → показывает attemptsLeft', async ({ page }) => {
    await setupApi(page, {
      '/api/auth/verify': (route) =>
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'wrong_code', attemptsLeft: 4 })
        })
    });

    await page.goto('/login.html');
    await page.fill('#slug-input', 'stomat_chln_01');
    await page.click('#btn-request');
    await page.fill('#code-input', '999999');
    await page.click('#btn-verify');
    await expect(page.locator('#err-code')).toContainText('Попыток осталось: 4');
  });

  test('код короче 6 цифр — submit-кнопка валидирует', async ({ page }) => {
    await setupApi(page);
    await page.goto('/login.html');
    await page.fill('#slug-input', 'stomat_chln_01');
    await page.click('#btn-request');
    await page.fill('#code-input', '123');
    await page.click('#btn-verify');
    await expect(page.locator('#err-code')).toContainText('6 цифр');
  });
});
