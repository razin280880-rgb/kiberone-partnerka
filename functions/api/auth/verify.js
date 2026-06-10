// POST /api/auth/verify
// Body: { partner_slug, code }
//
// Проверяет код в otp_codes. Если ок — создаёт сессию и ставит cookie.
// Защита: code = 6 цифр, attempts < 5, not consumed, not expired.

import {
  buildSessionCookie,
  createSession,
  jsonResponse,
  nowSec
} from '../../_lib/auth.js';

const MAX_ATTEMPTS = 5;

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return jsonResponse({ error: 'D1 не настроен' }, { status: 503 });
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'bad json' }, { status: 400 }); }

  const partner_slug = (body.partner_slug || '').trim();
  const code = String(body.code || '').replace(/\D/g, '');
  if (!partner_slug || code.length !== 6) {
    return jsonResponse({ error: 'bad_input' }, { status: 400 });
  }

  const otp = await env.DB.prepare(
    `SELECT id, code, attempts, consumed, expires_at
       FROM otp_codes
      WHERE partner_slug = ? AND consumed = 0
   ORDER BY created_at DESC LIMIT 1`
  ).bind(partner_slug).first();

  if (!otp) {
    return jsonResponse({ error: 'no_active_code' }, { status: 401 });
  }
  if (otp.expires_at < nowSec()) {
    await env.DB.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').bind(otp.id).run();
    return jsonResponse({ error: 'expired' }, { status: 401 });
  }
  if (otp.attempts >= MAX_ATTEMPTS) {
    await env.DB.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').bind(otp.id).run();
    return jsonResponse({ error: 'too_many_attempts' }, { status: 429 });
  }

  if (otp.code !== code) {
    await env.DB.prepare(
      'UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?'
    ).bind(otp.id).run();
    return jsonResponse({
      error: 'wrong_code',
      attemptsLeft: MAX_ATTEMPTS - otp.attempts - 1
    }, { status: 401 });
  }

  // Успех — гасим код, создаём сессию.
  await env.DB.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').bind(otp.id).run();
  const token = await createSession(env, partner_slug, request);

  return jsonResponse(
    { ok: true, partner_slug },
    { setCookie: buildSessionCookie(token) }
  );
}
