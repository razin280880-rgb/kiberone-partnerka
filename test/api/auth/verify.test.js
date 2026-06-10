import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestPost } from '../../../functions/api/auth/verify.js';
import { makeEnv } from '../../helpers/fake-env.js';
import { jsonPost } from '../../helpers/fake-request.js';

describe('POST /api/auth/verify', () => {
  let env;

  beforeEach(() => {
    env = makeEnv();
  });

  it('200 + ставит cookie kp_session при правильном коде', async () => {
    env.DB.on('FROM otp_codes', {
      first: () => ({
        id: 1,
        code: '123456',
        attempts: 0,
        consumed: 0,
        expires_at: Math.floor(Date.now() / 1000) + 300
      })
    });
    env.DB.on('UPDATE otp_codes SET consumed = 1', { run: () => ({}) });
    env.DB.on('INSERT INTO sessions', { run: () => ({}) });

    const req = jsonPost('https://x/api/auth/verify', {
      partner_slug: 'stomat_chln_01',
      code: '123456'
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('Set-Cookie');
    expect(setCookie).toContain('kp_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('401 wrong_code + декремент attempts при неверном коде', async () => {
    let updated = null;
    env.DB.on('FROM otp_codes', {
      first: () => ({
        id: 1,
        code: '111111',
        attempts: 0,
        consumed: 0,
        expires_at: Math.floor(Date.now() / 1000) + 300
      })
    });
    env.DB.on('UPDATE otp_codes SET attempts = attempts + 1', {
      run: (args) => { updated = args; }
    });

    const req = jsonPost('https://x/api/auth/verify', {
      partner_slug: 'stomat_chln_01',
      code: '999999'
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('wrong_code');
    expect(data.attemptsLeft).toBe(4);
    expect(updated).toBeTruthy();
  });

  it('401 expired при истекшем коде', async () => {
    env.DB.on('FROM otp_codes', {
      first: () => ({
        id: 1,
        code: '111111',
        attempts: 0,
        consumed: 0,
        expires_at: Math.floor(Date.now() / 1000) - 10
      })
    });
    env.DB.on('UPDATE otp_codes SET consumed = 1', { run: () => ({}) });

    const req = jsonPost('https://x/api/auth/verify', {
      partner_slug: 'stomat_chln_01',
      code: '111111'
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('expired');
  });

  it('429 too_many_attempts после 5 попыток', async () => {
    env.DB.on('FROM otp_codes', {
      first: () => ({
        id: 1,
        code: '111111',
        attempts: 5,
        consumed: 0,
        expires_at: Math.floor(Date.now() / 1000) + 300
      })
    });
    env.DB.on('UPDATE otp_codes SET consumed = 1', { run: () => ({}) });

    const req = jsonPost('https://x/api/auth/verify', {
      partner_slug: 'stomat_chln_01',
      code: '111111'
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(429);
  });

  it('400 для невалидного входа (не 6 цифр)', async () => {
    const req = jsonPost('https://x/api/auth/verify', {
      partner_slug: 'a_chln_01',
      code: '123'
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });
});
