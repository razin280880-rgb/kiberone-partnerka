// POST /api/auth/owner/request-code
// Body: { telegram_id }
//
// 1. Проверяет, что telegram_id в whitelist OWNER_TELEGRAM_IDS.
// 2. Шлёт 6-значный код этому Telegram-аккаунту через @Kiber_partner_bot.
// 3. Сохраняет в owner_otp (TTL 10 мин, max 3 кода/окно).
//
// В отличие от партнёрского flow — без slug. Owner один (или несколько whitelisted),
// идентифицируется напрямую по своему Telegram ID.

import { generateOtpCode, isOwnerTelegramId, jsonResponse, nowSec } from '../../../_lib/auth.js';
import { sendMessage } from '../../../_lib/telegram.js';

const OTP_TTL_SEC = 600;
const THROTTLE_WINDOW_SEC = 600;
const THROTTLE_MAX = 3;

async function checkThrottle(env, telegram_id) {
  const now = nowSec();
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM owner_otp WHERE telegram_user_id = ? AND created_at >= ?'
  ).bind(telegram_id, now - THROTTLE_WINDOW_SEC).first();
  if ((row?.cnt || 0) >= THROTTLE_MAX) {
    return { ok: false, retryAfter: THROTTLE_WINDOW_SEC };
  }
  return { ok: true };
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonResponse({ error: 'd1_unavailable' }, { status: 503 });

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'bad_json' }, { status: 400 }); }

  const telegram_id = parseInt(body.telegram_id, 10);
  if (!telegram_id) {
    return jsonResponse({ error: 'bad_input' }, { status: 400 });
  }

  // Намеренно одинаковый ответ для not-in-whitelist и для прошёл — не светим whitelist.
  if (!isOwnerTelegramId(env, telegram_id)) {
    return jsonResponse({
      ok: false,
      error: 'access_denied',
      message: 'Этот Telegram ID не имеет доступа.'
    }, { status: 403 });
  }

  const throttle = await checkThrottle(env, telegram_id);
  if (!throttle.ok) {
    return jsonResponse({ error: 'throttled', retryAfter: throttle.retryAfter }, { status: 429 });
  }

  // Гасим прежние неиспользованные коды.
  await env.DB.prepare(
    'UPDATE owner_otp SET consumed = 1 WHERE telegram_user_id = ? AND consumed = 0'
  ).bind(telegram_id).run();

  const code = generateOtpCode();
  const now = nowSec();
  await env.DB.prepare(
    'INSERT INTO owner_otp (telegram_user_id, code, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(telegram_id, code, now, now + OTP_TTL_SEC).run();

  await sendMessage(env, telegram_id,
    `<b>🔑 Код для админ-кабинета KIBERone:</b>\n\n<code>${code}</code>\n\n` +
    `Действует 10 минут. Если это не вы — игнорируйте.`);

  return jsonResponse({ ok: true, expiresIn: OTP_TTL_SEC });
}
