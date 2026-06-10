import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestPost } from '../../../functions/api/auth/request-code.js';
import { makeEnv } from '../../helpers/fake-env.js';
import { jsonPost } from '../../helpers/fake-request.js';
import { makeFakeFetch } from '../../helpers/fake-fetch.js';

describe('POST /api/auth/request-code', () => {
  let env, fakeFetch;

  beforeEach(() => {
    env = makeEnv();
    fakeFetch = makeFakeFetch().route('api.telegram.org', { body: { ok: true } });
    fakeFetch.install();
  });

  it('200 + отправляет код, если партнёр найден и Telegram привязан', async () => {
    env.DB.on('LEFT JOIN telegram_bindings', {
      first: () => ({
        telegram_user_id: 12345,
        telegram_username: 'user1',
        name: 'Зубарик'
      })
    });
    env.DB.on('SELECT window_start, count FROM otp_throttle', { first: () => null });
    env.DB.on('INSERT INTO otp_throttle', { run: () => ({}) });
    env.DB.on('UPDATE otp_codes SET consumed = 1', { run: () => ({}) });
    env.DB.on('INSERT INTO otp_codes', { run: () => ({}) });

    const req = jsonPost('https://x/api/auth/request-code', { partner_slug: 'stomat_chln_01' });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);

    // Telegram-вызов был с сообщением, содержащим 6 цифр.
    const tgCall = fakeFetch.calls.find(c => c.url.includes('sendMessage'));
    expect(tgCall).toBeTruthy();
    const tgBody = JSON.parse(tgCall.init.body);
    expect(tgBody.text).toMatch(/\d{6}/);
    expect(tgBody.chat_id).toBe(12345);
  });

  it('404 not_linked, если партнёра нет / Telegram не привязан', async () => {
    env.DB.on('LEFT JOIN telegram_bindings', { first: () => null });
    const req = jsonPost('https://x/api/auth/request-code', { partner_slug: 'ghost' });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('not_linked');
  });

  it('429 throttled при 4-м запросе в 10-минутном окне', async () => {
    env.DB.on('LEFT JOIN telegram_bindings', {
      first: () => ({ telegram_user_id: 1, telegram_username: 'u', name: 'X' })
    });
    env.DB.on('SELECT window_start, count FROM otp_throttle', {
      first: () => ({ window_start: Math.floor(Date.now() / 1000) - 60, count: 3 })
    });
    const req = jsonPost('https://x/api/auth/request-code', { partner_slug: 'a_chln_01' });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(429);
  });

  it('400 без partner_slug', async () => {
    const req = jsonPost('https://x/api/auth/request-code', {});
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });
});
