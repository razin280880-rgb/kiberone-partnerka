// POST /api/auth/owner/verify
// Body: { telegram_id, code }

import {
  buildSessionCookie,
  createOwnerSession,
  isOwnerTelegramId,
  jsonResponse,
  nowSec
} from '../../../_lib/auth.js';

const MAX_ATTEMPTS = 5;

export async function onRequestPost({ request, env }) {
  if (!env.DB) return jsonResponse({ error: 'd1_unavailable' }, { status: 503 });

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'bad_json' }, { status: 400 }); }

  const telegram_id = parseInt(body.telegram_id, 10);
  const code = String(body.code || '').replace(/\D/g, '');
  if (!telegram_id || code.length !== 6) {
    return jsonResponse({ error: 'bad_input' }, { status: 400 });
  }

  if (!isOwnerTelegramId(env, telegram_id)) {
    return jsonResponse({ error: 'access_denied' }, { status: 403 });
  }

  const otp = await env.DB.prepare(
    `SELECT id, code, attempts, expires_at FROM owner_otp
      WHERE telegram_user_id = ? AND consumed = 0
   ORDER BY created_at DESC LIMIT 1`
  ).bind(telegram_id).first();

  if (!otp) return jsonResponse({ error: 'no_active_code' }, { status: 401 });
  if (otp.expires_at < nowSec()) {
    await env.DB.prepare('UPDATE owner_otp SET consumed = 1 WHERE id = ?').bind(otp.id).run();
    return jsonResponse({ error: 'expired' }, { status: 401 });
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    await env.DB.prepare('UPDATE owner_otp SET consumed = 1 WHERE id = ?').bind(otp.id).run();
    return jsonResponse({ error: 'too_many_attempts' }, { status: 429 });
  }

  if (otp.code !== code) {
    await env.DB.prepare(
      'UPDATE owner_otp SET attempts = attempts + 1 WHERE id = ?'
    ).bind(otp.id).run();
    return jsonResponse({
      error: 'wrong_code',
      attemptsLeft: MAX_ATTEMPTS - otp.attempts - 1
    }, { status: 401 });
  }

  // Успех — гасим код, создаём owner-сессию.
  await env.DB.prepare('UPDATE owner_otp SET consumed = 1 WHERE id = ?').bind(otp.id).run();
  const token = await createOwnerSession(env, telegram_id, request);

  return jsonResponse(
    { ok: true, role: 'owner' },
    { setCookie: buildSessionCookie(token) }
  );
}
