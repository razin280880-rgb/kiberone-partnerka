// Realtime toast + soft-reload в кабинете.
import { test, expect } from '@playwright/test';
import { setupApi } from './helpers/mock-api.js';

test.describe('Realtime — push в кабинет', () => {

  test('партнёр видит toast при new_lead', async ({ page }) => {
    // 1-й polling /api/realtime/events отдаёт пустоту, 2-й — событие.
    let pollCount = 0;
    await setupApi(page, {
      '/api/auth/me': (route) =>
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({
            authenticated: true,
            partner_slug: 'stomat_chln_01',
            partner: { name: 'Зубарик', city: 'Челны', tier: 'silver', slug: 'stomat_chln_01' }
          }) }),
      '/api/realtime/events': (route) => {
        pollCount++;
        const ts = Math.floor(Date.now() / 1000);
        if (pollCount === 1) {
          return route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ events: [], serverTs: ts, nextSince: ts }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({
            events: [{
              id: 99, type: 'new_lead',
              payload: { lead_id: 99, child_age: 9, partner_slug: 'stomat_chln_01' },
              ts
            }],
            serverTs: ts, nextSince: ts
          }) });
      }
    });

    await page.goto('/cabinet.html');
    // Ждём, пока сработает второй polling-цикл (~5 сек).
    await expect(page.locator('.rt-toast')).toContainText('Новая анкета', { timeout: 15000 });
    await expect(page.locator('.rt-toast')).toContainText('9 лет');
  });

  test('owner получает dispute_opened с лидом', async ({ page }) => {
    let pollCount = 0;
    await setupApi(page, {
      '/api/auth/me': (route) =>
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ authenticated: true, partner_slug: '__owner__' }) }),
      '/api/admin/overview': (route) =>
        route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({
            period: 'week',
            total: { scans: 0, leads: 0, trials: 0, paid: 0, amount: 0, activePartners: 0 },
            cities: [],
            topPartners: [], bottomPartners: [],
            dynamics12w: [], activeDisputes: 0, mrs: []
          }) }),
      '/api/realtime/events': (route) => {
        pollCount++;
        const ts = Math.floor(Date.now() / 1000);
        if (pollCount === 1) {
          return route.fulfill({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ events: [], serverTs: ts, nextSince: ts }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({
            events: [{ id: 1, type: 'dispute_opened', payload: { lead_id: 42 }, ts }],
            serverTs: ts, nextSince: ts
          }) });
      }
    });

    await page.goto('/owner.html');
    await expect(page.locator('.rt-toast')).toContainText('диспут', { timeout: 15000 });
    await expect(page.locator('.rt-toast')).toContainText('#42');
  });
});
