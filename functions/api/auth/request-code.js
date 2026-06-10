// POST /api/auth/request-code
// Body: { partner_slug }
//
// 1. Проверяет, что партнёр существует и привязал Telegram (telegram_bindings).
// 2. Rate-limit: не больше 3 кодов за 10 минут.
// 3. Генерит 6-значный код, сохраняет в otp_codes (TTL 10 минут).
// 4. Шлёт код через бот @Kiber_partner_bot.
// 5. Возвращает { ok: true, telegram_username } чтобы партнёр понимал, куда смотреть.

import { generateOtpCode, jsonResponse, nowSec } from '../../_lib/auth.js';
import { sendMessage } from '../../_lib/telegram.js';

const OTP_TTL_SEC = 600;
const THROTTLE_WINDOW_SEC = 600;
const THROTTLE_MAX_PER_WINDOW = 3;

async function checkThrottle(env, partner_slug) {
  const now = nowSec();
  const row = await env.DB.prepare(
    'SELECT window_start, count FROM otp_throttle WHERE partner_slug = ?'
  ).bind(partner_slug).first();

  if (!row) {
    await env.DB.prepare(
      'INSERT INTO otp_throttle (partner_slug, window_start, count) VALUES (?, ?, 1)'
    ).bind(partner_slug, now).run();
    return { ok: true };
  }

  const windowAge = now - row.window_start;
  if (windowAge > THROTTLE_WINDOW_SEC) {
    await env.DB.prepare(
      'UPDATE otp_throttle SET window_start = ?, count = 1 WHERE partner_slug = ?'
    ).bind(now, partner_slug).run();
    return { ok: true };
  }

  if (row.count >= THROTTLE_MAX_PER_WINDOW) {
    return {
      ok: false,
      retryAfter: THROTTLE_WINDOW_SEC - windowAge
    };
  }

  await env.DB.prepare(
    'UPDATE otp_throttle SET count = count + 1 WHERE partner_slug = ?'
  ).bind(partner_slug).run();
  return { ok: true };
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return jsonResponse({ error: 'D1 не настроен' }, { status: 503 });
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'bad json' }, { status: 400 }); }

  const partner_slug = (body.partner_slug || '').trim();
  if (!partner_slug) {
    return jsonResponse({ error: 'partner_slug обязателен' }, { status: 400 });
  }

  // Намеренно не различаем "партнёр не найден" и "Telegram не привязан" —
  // обе ситуации одинаково раскрывают существование slug. Возвращаем общий код.
  const binding = await env.DB.prepare(
    `SELECT b.telegram_user_id, b.telegram_username, p.name
       FROM partners p
       LEFT JOIN telegram_bindings b ON b.partner_slug = p.slug
      WHERE p.slug = ? AND p.status = 'active'`
  ).bind(partner_slug).first();

  if (!binding || !binding.telegram_user_id) {
    return jsonResponse({
      error: 'not_linked',
      message: 'Сначала привяжите Telegram: напишите боту @Kiber_partner_bot команду /start ' + partner_slug
    }, { status: 404 });
  }

  const throttle = await checkThrottle(env, partner_slug);
  if (!throttle.ok) {
    return jsonResponse({
      error: 'throttled',
      retryAfter: throttle.retryAfter,
      message: `Слишком частые запросы. Подождите ${Math.ceil(throttle.retryAfter / 60)} мин.`
    }, { status: 429 });
  }

  // Гасим предыдущие неиспользованные коды этого партнёра.
  await env.DB.prepare(
    'UPDATE otp_codes SET consumed = 1 WHERE partner_slug = ? AND consumed = 0'
  ).bind(partner_slug).run();

  const code = generateOtpCode();
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO otp_codes (partner_slug, code, created_at, expires_at)
     VALUES (?, ?, ?, ?)`
  ).bind(partner_slug, code, now, now + OTP_TTL_SEC).run();

  await sendMessage(
    env,
    binding.telegram_user_id,
    `<b>Код для входа в кабинет:</b>\n\n` +
    `<code>${code}</code>\n\n` +
    `Действует 10 минут. Если это не вы — игнорируйте это сообщение.\n\n` +
    `Партнёр: ${binding.name || partner_slug}`
  );

  return jsonResponse({
    ok: true,
    telegram_username: binding.telegram_username || null,
    expiresIn: OTP_TTL_SEC
  });
}
