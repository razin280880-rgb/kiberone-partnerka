// Owner-flow: login → дашборд → диспуты.
import { test, expect } from '@playwright/test';
import { setupApi } from './helpers/mock-api.js';

const OWNER_OVERVIEW = {
  period: 'week',
  total: { scans: 320, leads: 87, trials: 23, paid: 4, amount: 24500, activePartners: 18 },
  cities: [
    { city: 'chln', cityName: 'Челны', scans: 180, leads: 47, trials: 14, paid: 3, amount: 15500, activePartners: 9 },
    { city: 'nkmsk', cityName: 'Нижнекамск', scans: 50, leads: 12, trials: 4, paid: 1, amount: 4200, activePartners: 3 },
    { city: 'kzn', cityName: 'Казань', scans: 40, leads: 15, trials: 3, paid: 0, amount: 3000, activePartners: 2 },
    { city: 'elb', cityName: 'Елабуга', scans: 20, leads: 5, trials: 1, paid: 0, amount: 1000, activePartners: 1 },
    { city: 'krd', cityName: 'Краснодар', scans: 15, leads: 4, trials: 1, paid: 0, amount: 600, activePartners: 1 },
    { city: 'srg', cityName: 'Сургут', scans: 10, leads: 2, trials: 0, paid: 0, amount: 200, activePartners: 1 },
    { city: 'prm', cityName: 'Пермь', scans: 5, leads: 2, trials: 0, paid: 0, amount: 0, activePartners: 1 }
  ],
  topPartners: [
    { slug: 'stomat_chln_01', name: 'Зубарик', city: 'chln', leads: 18, paid: 2 },
    { slug: 'eng_chln_01', name: 'ABC English', city: 'chln', leads: 12, paid: 1 },
    { slug: 'chess_kzn_01', name: 'Дебют', city: 'kzn', leads: 9, paid: 0 }
  ],
  bottomPartners: [
    { slug: 'cafe_chln_01', name: 'Карамелька', city: 'chln', last_lead: Math.floor(Date.now() / 1000) - 14 * 86400 }
  ],
  dynamics12w: Array.from({ length: 12 }, (_, i) => ({
    label: `${i + 1}.06`, leads: 20 + i * 3, paid: i, amount: 1000 + i * 500
  })),
  activeDisputes: 2,
  mrs: [
    { mr_name: 'Анна', mr_telegram: '111', partners: 9, leads: 47, paid: 3 },
    { mr_name: 'Елена', mr_telegram: '222', partners: 3, leads: 12, paid: 1 }
  ]
};

test.describe('Owner — admin dashboard', () => {

  test('без сессии owner.html → редирект на /owner-login.html', async ({ page }) => {
    await setupApi(page);  // auth/me → authenticated: false
    await page.goto('/owner.html');
    await page.waitForURL(/\/owner-login\.html/);
    await expect(page.locator('h1')).toContainText('Вход в админ-кабинет');
  });

  test('happy path: вход → 6 KPI карточек → переключение таба → диспуты', async ({ page }) => {
    await setupApi(page, {
      '/api/auth/me': (route) =>
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ authenticated: true, partner_slug: '__owner__' }) }),
      '/api/admin/overview': (route) =>
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(OWNER_OVERVIEW) }),
      '/api/admin/disputes/list': (route) =>
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({
            disputes: [{
              id: 99, partner_slug: 'stomat_chln_01', partner_name: 'Зубарик',
              partner_city: 'chln', child_age: 9, status: 'rejected',
              dispute_reason: 'Этот ребёнок уже занимается у вас',
              submitted_at: Math.floor(Date.now() / 1000) - 86400,
              status_changed_at: Math.floor(Date.now() / 1000) - 3600,
              mr_name: 'Анна'
            }]
          }) })
    });

    await page.goto('/owner.html');

    // 6 KPI карточек
    await expect(page.locator('.stats-grid-6 .stat-card')).toHaveCount(6);
    await expect(page.locator('#ov-amount')).toContainText('24');
    await expect(page.locator('#ov-leads')).toContainText('87');
    await expect(page.locator('#ov-partners')).toContainText('18');

    // Badge с количеством диспутов
    await expect(page.locator('#disputes-badge')).toContainText('2');

    // Топ-партнёры
    await expect(page.locator('#ov-top .top-item')).toHaveCount(3);
    await expect(page.locator('#ov-top .top-item').first()).toContainText('Зубарик');

    // Переключаем на города
    await page.click('.cab-tab[data-tab="cities"]');
    await expect(page.locator('[data-pane="cities"]')).toHaveClass(/active/);
    // 7 городов + строка "Всего"
    await expect(page.locator('#cities-tbody tr')).toHaveCount(8);
    await expect(page.locator('#cities-tbody tr').first()).toContainText('Челны');

    // Переключаем на диспуты — подгружается lazy
    await page.click('.cab-tab[data-tab="disputes"]');
    await expect(page.locator('#disputes-tbody tr')).toHaveCount(1);
    await expect(page.locator('#disputes-tbody')).toContainText('Зубарик');
    await expect(page.locator('#disputes-tbody')).toContainText('Этот ребёнок уже занимается');
  });

  test('переключение period перезагружает overview', async ({ page }) => {
    let requestedPeriods = [];
    await setupApi(page, {
      '/api/auth/me': (route) =>
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ authenticated: true, partner_slug: '__owner__' }) }),
      '/api/admin/overview': (route) => {
        const url = new URL(route.request().url());
        requestedPeriods.push(url.searchParams.get('period'));
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify(OWNER_OVERVIEW) });
      }
    });

    await page.goto('/owner.html');
    await page.waitForFunction(() => document.querySelector('#ov-leads').textContent !== '—');
    await page.selectOption('#period-select', 'month');
    await page.waitForFunction(() => true, { timeout: 500 });
    expect(requestedPeriods).toContain('week');
    expect(requestedPeriods).toContain('month');
  });
});
