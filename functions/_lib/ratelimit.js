// Скользящее окно rate-limit поверх D1.
// Дёшево (1 запись на ключ), хватит для пилотных нагрузок.
// Когда вырастем — заменим на KV или Durable Object.

import { nowSec } from './auth.js';

function getIP(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown'
  );
}

/**
 * @param env — Pages Functions env (содержит DB).
 * @param key — строка-идентификатор окна (например, 'scan:1.2.3.4').
 * @param max — сколько запросов разрешено в окне.
 * @param windowSec — длина окна в секундах.
 * @returns { ok: boolean, retryAfter?: number, remaining?: number }
 */
async function rateLimit(env, key, max, windowSec) {
  if (!env.DB) return { ok: true };
  const now = nowSec();

  const row = await env.DB.prepare(
    'SELECT window_start, count FROM rate_limits WHERE rl_key = ?'
  ).bind(key).first();

  if (!row) {
    await env.DB.prepare(
      'INSERT INTO rate_limits (rl_key, window_start, count) VALUES (?, ?, 1)'
    ).bind(key, now).run();
    return { ok: true, remaining: max - 1 };
  }

  // Окно протухло — стартуем новое.
  if (now - row.window_start > windowSec) {
    await env.DB.prepare(
      'UPDATE rate_limits SET window_start = ?, count = 1 WHERE rl_key = ?'
    ).bind(now, key).run();
    return { ok: true, remaining: max - 1 };
  }

  if (row.count >= max) {
    return { ok: false, retryAfter: windowSec - (now - row.window_start) };
  }

  await env.DB.prepare(
    'UPDATE rate_limits SET count = count + 1 WHERE rl_key = ?'
  ).bind(key).run();

  return { ok: true, remaining: max - row.count - 1 };
}

export { rateLimit, getIP };
