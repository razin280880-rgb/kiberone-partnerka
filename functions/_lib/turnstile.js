// Cloudflare Turnstile — server-side verify.
// Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
//
// Опт-ин: если TURNSTILE_SECRET_KEY не задан в env — verify проходит как { ok: true, skipped: true }.
// Это значит локальный wrangler pages dev и демо без ключей работают, но прод с настроенным секретом
// требует валидный токен.

import { getIP } from './ratelimit.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * @param env — Pages env (читаем TURNSTILE_SECRET_KEY).
 * @param token — cf-turnstile-response из формы.
 * @param request — оригинальный Request (для CF-Connecting-IP).
 * @returns { ok: boolean, skipped?: boolean, errors?: string[], action?: string, hostname?: string }
 */
async function verifyTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { ok: true, skipped: true };
  }
  if (!token || typeof token !== 'string') {
    return { ok: false, errors: ['missing-token'] };
  }

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', token);
  form.append('remoteip', getIP(request));

  try {
    const r = await fetch(VERIFY_URL, { method: 'POST', body: form });
    const data = await r.json();
    return {
      ok: !!data.success,
      errors: data['error-codes'] || [],
      action: data.action,
      hostname: data.hostname,
      challenge_ts: data.challenge_ts
    };
  } catch (e) {
    console.error('turnstile verify network error', e);
    return { ok: false, errors: ['network-error'] };
  }
}

export { verifyTurnstile };
