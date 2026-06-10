// Полный happy-path: QR → мини-игра → форма → награда.
import { test, expect } from '@playwright/test';
import { setupApi } from './helpers/mock-api.js';

test.describe('QR funnel — партнёрская воронка', () => {

  test.beforeEach(async ({ page }) => {
    await setupApi(page);
  });

  test('сценарий ребёнок-родитель: 5 экранов до награды', async ({ page }) => {
    // ---------- Экран 1: Welcome ----------
    await page.goto('/?p=stomat_chln_01');
    await expect(page.locator('#screen-welcome.active')).toBeVisible();
    await expect(page.locator('h1')).toContainText('кибергероем');
    await expect(page.locator('#city-name')).toContainText('Челнах');
    await expect(page.locator('#live-count')).toHaveText(/\d+/);

    // ---------- Экран 2: Конструктор кибергероя ----------
    await page.click('#btn-start');
    await expect(page.locator('#screen-game.active')).toBeVisible();

    // Шаг 1: цвет
    await expect(page.locator('#step-current')).toHaveText('1');
    await page.locator('button.choice[data-color="cyan"]').click();

    // Шаг 2: оружие
    await expect(page.locator('#step-current')).toHaveText('2');
    await page.locator('[data-weapon="laptop"]').click();

    // Шаг 3: способность
    await expect(page.locator('#step-current')).toHaveText('3');
    await page.locator('[data-power="logic"]').click();

    // Шаг 4: имя
    await expect(page.locator('#step-current')).toHaveText('4');
    await page.fill('#hero-name-input', 'Эмиль');
    // Имя реактивно появляется в бейдже
    await expect(page.locator('#hero-name-tag')).toHaveText('Эмиль');
    await page.click('#btn-name-confirm');

    // ---------- Экран 3: Результат + curiosity gap ----------
    await expect(page.locator('#screen-result.active')).toBeVisible();
    await expect(page.locator('#result-name')).toHaveText('Эмиль');
    await expect(page.locator('.curiosity-item.revealed')).toHaveCount(2);
    await expect(page.locator('.curiosity-item.locked')).toHaveCount(3);

    // ---------- Микро-коммитмент ----------
    await page.click('#btn-want-plan');

    // ---------- Экран 4: Форма ----------
    await expect(page.locator('#screen-form.active')).toBeVisible();
    await expect(page.locator('#f-child-name')).toHaveValue('Эмиль');  // префилл
    // Таймер обратного отсчёта запустился (формат HH:MM:SS).
    await expect(page.locator('#timer')).toContainText(/\d\d:\d\d:\d\d/);

    await page.selectOption('#f-child-age', '9');
    await page.fill('#f-parent-whatsapp', '9170000000');  // маска должна преобразовать к +7
    await expect(page.locator('#f-parent-whatsapp')).toHaveValue(/\+7/);

    await page.click('#btn-submit');

    // ---------- Экран 5: Награда ----------
    await expect(page.locator('#screen-reward.active')).toBeVisible();
    await expect(page.locator('#reward-child-name')).toHaveText('Эмиль');
    await expect(page.locator('#reward-tutor-name')).toHaveText('Анна');
    await expect(page.locator('#reward-city')).toHaveText('Челнах');
    await expect(page.locator('#reward-age')).toHaveText('9');
    await expect(page.locator('#invitation-name')).toHaveText('Эмиль');

    // PDF/HTML-роадмап
    const roadmap = page.locator('#reward-pdf-link');
    await expect(roadmap).toHaveAttribute('href', /srednyaya-8-11/);

    // Слоты из API подгружены
    await expect(page.locator('.slot')).toHaveCount(3);

    // Жетон-карточка обязательства видна
    await expect(page.locator('.token-card')).toContainText('жетон');
  });

  test('выбор слота → запись', async ({ page }) => {
    await page.goto('/?p=stomat_chln_01');
    // Быстрый путь до награды — сразу через игру
    await page.click('#btn-start');
    await page.locator('button.choice[data-color="purple"]').click();
    await page.locator('[data-weapon="sword"]').click();
    await page.locator('[data-power="speed"]').click();
    await page.fill('#hero-name-input', 'Дамир');
    await page.click('#btn-name-confirm');
    await page.click('#btn-want-plan');
    await page.selectOption('#f-child-age', '7');
    await page.fill('#f-parent-whatsapp', '9170000001');
    await page.click('#btn-submit');

    // Выбираем первый слот
    await page.locator('.slot').first().click();
    await expect(page.locator('#btn-book-slot')).toBeEnabled();
    await page.click('#btn-book-slot');
    await expect(page.locator('#btn-book-slot')).toContainText('Забронировано');
  });

  test('UTM из URL определяет тьютора и город', async ({ page }) => {
    await page.goto('/?p=eng_krd_01');  // Краснодар → Виктория
    await expect(page.locator('#city-name')).toContainText('Краснодаре');
  });

  test('возраст ребёнка определяет роадмап', async ({ page }) => {
    // Перехватим submit чтобы проверить, что фронт корректно проставляет возраст
    let capturedAge = null;
    await page.route('**/api/submit*', async (route) => {
      const post = await route.request().postDataJSON();
      capturedAge = post.child_age;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true, leadId: 1,
          roadmapUrl: '/roadmaps/starshaya-12-14.html',
          videoUrl: '/videos/chln-starshaya-12-14.mp4',
          tutor: { name: 'Анна', city: 'Челнах' },
          slots: []
        })
      });
    });

    await page.goto('/?p=stomat_chln_01');
    await page.click('#btn-start');
    await page.locator('button.choice[data-color="green"]').click();
    await page.locator('[data-weapon="wand"]').click();
    await page.locator('[data-power="strategy"]').click();
    await page.fill('#hero-name-input', 'Тимур');
    await page.click('#btn-name-confirm');
    await page.click('#btn-want-plan');
    await page.selectOption('#f-child-age', '13');
    await page.fill('#f-parent-whatsapp', '9170000002');
    await page.click('#btn-submit');

    await expect(page.locator('#screen-reward.active')).toBeVisible();
    expect(capturedAge).toBe(13);
    await expect(page.locator('#reward-pdf-link')).toHaveAttribute('href', /starshaya/);
  });

  test('honeypot скрыт от пользователя но есть в DOM', async ({ page }) => {
    await page.goto('/?p=stomat_chln_01');
    await page.click('#btn-start');
    // Идём до формы
    await page.locator('button.choice[data-color="purple"]').click();
    await page.locator('[data-weapon="laptop"]').click();
    await page.locator('[data-power="logic"]').click();
    await page.fill('#hero-name-input', 'Иван');  // мин 2 символа для активации кнопки
    await page.click('#btn-name-confirm');
    await page.click('#btn-want-plan');

    const honeypot = page.locator('#f-website');
    await expect(honeypot).toBeAttached();          // в DOM
    await expect(honeypot).not.toBeInViewport();    // визуально вне экрана
    await expect(honeypot).toHaveAttribute('tabindex', '-1');
  });
});
