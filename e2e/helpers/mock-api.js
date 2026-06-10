// Перехватчики /api/* для Playwright.
// Используем в beforeEach каждого spec'а: setupApi(page, { overrides })

/**
 * Подставляет дефолтные ответы для всех публичных endpoint'ов QR-страницы.
 * @param {import('@playwright/test').Page} page
 * @param {Object} overrides — карта {path: handlerFn}. handlerFn(route) делает route.fulfill().
 */
export async function setupApi(page, overrides = {}) {
  const handlers = {
    '/api/config': (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ turnstileSiteKey: null })
      }),

    '/api/stats': (route) => {
      // Live-счётчик: /api/stats?type=live&city=chln
      const url = new URL(route.request().url());
      if (url.searchParams.get('type') === 'live') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ todayCount: 47 })
        });
      }
      // По умолчанию — пустой ответ 200, чтобы кабинет рендерился из моков.
      // Тесты, проверяющие неавторизованный доступ, должны мокать /api/auth/me как unauthenticated
      // (тогда cabinet.js уйдёт на login до запроса /api/stats).
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ stats: {}, partner: null })
      });
    },

    '/api/scan': (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      }),

    '/api/submit': (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          leadId: 42,
          roadmapUrl: '/roadmaps/srednyaya-8-11.html',
          videoUrl: '/videos/chln-srednyaya-8-11.mp4',
          tutor: { name: 'Анна', city: 'Челнах' },
          slots: [
            { iso: '2026-06-14T10:00:00Z', label: 'Сб, 14 июн в 10:00' },
            { iso: '2026-06-14T11:30:00Z', label: 'Сб, 14 июн в 11:30' },
            { iso: '2026-06-15T10:00:00Z', label: 'Вс, 15 июн в 10:00' }
          ]
        })
      }),

    '/api/book-slot': (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),

    '/api/auth/me': (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: false })
      }),

    '/api/auth/request-code': (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, telegram_username: 'kiber_test', expiresIn: 600 })
      }),

    '/api/auth/verify': (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'kp_session=mocktoken; Path=/; SameSite=Strict'
        },
        body: JSON.stringify({ ok: true, partner_slug: 'stomat_chln_01' })
      }),

    '/api/auth/logout': (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }),

    '/api/leads/list': (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ leads: [] })
      }),

    // Realtime — по умолчанию пустой ответ. Тесты, которые проверяют push,
    // переопределяют этот route.
    '/api/realtime/events': (route) => {
      const ts = Math.floor(Date.now() / 1000);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [], serverTs: ts, nextSince: ts })
      });
    }
  };

  const merged = { ...handlers, ...overrides };

  // Регистрация: матчим по pathname (без query).
  for (const [path, handler] of Object.entries(merged)) {
    await page.route(`**${path}*`, handler);
  }
}
