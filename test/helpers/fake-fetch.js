// Перехватчик global.fetch.
// route(matcher, response) — добавить ожидаемый URL/паттерн и ответ.
// install() — поставить vi.fn() на global.fetch.

import { vi } from 'vitest';

export function makeFakeFetch() {
  const routes = [];
  const calls = [];

  const fn = vi.fn(async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    const route = routes.find(r =>
      typeof r.match === 'function' ? r.match(url, init) : url.includes(r.match)
    );
    if (!route) {
      return new Response(JSON.stringify({ error: 'no route', url }), {
        status: 599,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const body = typeof route.body === 'function' ? route.body(url, init) : route.body;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: route.status || 200,
      headers: route.headers || { 'Content-Type': 'application/json' }
    });
  });

  return {
    fn,
    route(matcher, response) {
      routes.push({ match: matcher, ...response });
      return this;
    },
    install() {
      globalThis.fetch = fn;
    },
    calls
  };
}
