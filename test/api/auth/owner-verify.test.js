import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestPost } from '../../../functions/api/auth/owner/verify.js';
import { makeEnv } from '../../helpers/fake-env.js';
import { jsonPost } from '../../helpers/fake-request.js';

describe('POST /api/auth/owner/verify', () => {
  let env;

  beforeEach(() => {
    env = makeEnv({ OWNER_TELEGRAM_IDS: '400383551,99999999' });
  });

  it('403, если telegram_id не в whitelist', async () => {
    const req = jsonPost('https://x/api/auth/owner/verify', { telegram_id: 12345, code: '123456' });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('access_denied');
  });

  it('200 + owner-session-cookie при правильном коде', async () => {
    env.DB.on('FROM owner_otp', {
      first: () => ({
        id: 1, code: '123456', attempts: 0,
        expires_at: Math.floor(Date.now() / 1000) + 300
      })
    });
    env.DB.on('UPDATE owner_otp SET consumed = 1', { run: () => ({}) });
    env.DB.on('INSERT INTO sessions', { run: () => ({}) });

    const req = jsonPost('https://x/api/auth/owner/verify', {
      telegram_id: 400383551, code: '123456'
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.role).toBe('owner');
    expect(res.headers.get('Set-Cookie')).toContain('kp_session=');
  });

  it('401 wrong_code + attemptsLeft', async () => {
    env.DB.on('FROM owner_otp', {
      first: () => ({
        id: 1, code: '111111', attempts: 1,
        expires_at: Math.floor(Date.now() / 1000) + 300
      })
    });
    env.DB.on('UPDATE owner_otp SET attempts', { run: () => ({}) });

    const req = jsonPost('https://x/api/auth/owner/verify', {
      telegram_id: 400383551, code: '999999'
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('wrong_code');
    expect(data.attemptsLeft).toBe(3);
  });

  it('400 при коде не 6 цифр', async () => {
    const req = jsonPost('https://x/api/auth/owner/verify', {
      telegram_id: 400383551, code: '12'
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });
});
