import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { onRequestPost } from '../../functions/api/submit.js';
import { makeEnv } from '../helpers/fake-env.js';
import { jsonPost } from '../helpers/fake-request.js';
import { makeFakeFetch } from '../helpers/fake-fetch.js';

function basePayload(overrides = {}) {
  return {
    partner_slug: 'stomat_chln_01',
    session_id: 'sess_abc',
    child_name: 'Эмиль',
    child_age: 9,
    parent_whatsapp: '79170000000',
    hero_config: { color: 'purple', name: 'Эмиль' },
    ...overrides
  };
}

function happyPathDb(env) {
  // /api/submit: scan timing-check
  env.DB.on('SELECT scanned_at FROM scans', {
    first: () => ({ scanned_at: Math.floor(Date.now() / 1000) - 60 })
  });
  // rate-limit
  env.DB.on('SELECT window_start', { first: () => null });
  env.DB.on('INSERT INTO rate_limits', { run: () => ({}) });
  // saveToD1
  env.DB.on('INSERT INTO leads', { run: () => ({ last_row_id: 42, changes: 1 }) });
  // notifyPartnerInTelegram: telegram_bindings
  env.DB.on('FROM telegram_bindings', { first: () => null });
}

describe('POST /api/submit — happy path', () => {
  let env, fakeFetch;

  beforeEach(() => {
    env = makeEnv();
    happyPathDb(env);
    fakeFetch = makeFakeFetch();
    fakeFetch.install();
  });

  it('сохраняет лид и возвращает награду', async () => {
    const req = jsonPost('https://x/api/submit', basePayload());
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.leadId).toBe(42);
    expect(data.roadmapUrl).toBe('/roadmaps/srednyaya-8-11.html');
    expect(data.videoUrl).toBe('/videos/chln-srednyaya-8-11.mp4');
    expect(data.tutor.name).toBe('Анна');
    expect(data.slots.length).toBeGreaterThan(0);
  });

  it('возрастные группы: 6 → mladshaya, 12 → starshaya', async () => {
    const req1 = jsonPost('https://x/api/submit', basePayload({ child_age: 6 }));
    const data1 = await (await onRequestPost({ request: req1, env })).json();
    expect(data1.roadmapUrl).toContain('mladshaya');

    const req2 = jsonPost('https://x/api/submit', basePayload({ child_age: 13 }));
    const data2 = await (await onRequestPost({ request: req2, env })).json();
    expect(data2.roadmapUrl).toContain('starshaya');
  });
});

describe('POST /api/submit — антифрод', () => {
  let env, fakeFetch;

  beforeEach(() => {
    env = makeEnv();
    fakeFetch = makeFakeFetch();
    fakeFetch.install();
  });

  it('honeypot: заполненное поле website → 200 ok, в БД ничего', async () => {
    let dbWritten = false;
    env.DB.on('INSERT INTO leads', { run: () => { dbWritten = true; } });

    const req = jsonPost('https://x/api/submit', basePayload({ website: 'http://spam' }));
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.leadId).toBeNull();
    expect(dbWritten).toBe(false);
  });

  it('timing: форма заполнена < 5 сек после скана → 429 too_fast', async () => {
    env.DB.on('SELECT scanned_at FROM scans', {
      first: () => ({ scanned_at: Math.floor(Date.now() / 1000) - 1 })
    });

    const req = jsonPost('https://x/api/submit', basePayload());
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toBe('too_fast');
  });

  it('rate-limit: 6-я анкета с одного IP/партнёра за час → 429', async () => {
    env.DB.on('SELECT scanned_at FROM scans', {
      first: () => ({ scanned_at: Math.floor(Date.now() / 1000) - 60 })
    });
    env.DB.on('SELECT window_start', {
      first: () => ({ window_start: Math.floor(Date.now() / 1000) - 60, count: 5 })
    });

    const req = jsonPost('https://x/api/submit', basePayload());
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toBe('rate_limited');
  });

  it('400 при отсутствии обязательных полей', async () => {
    const req = jsonPost('https://x/api/submit', basePayload({ child_name: '' }));
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/submit — Turnstile', () => {
  let env, fakeFetch;

  beforeEach(() => {
    env = makeEnv({ TURNSTILE_SECRET_KEY: 'SEC' });
    happyPathDb(env);
    fakeFetch = makeFakeFetch();
    fakeFetch.install();
  });

  it('403 captcha_failed без токена, когда секрет настроен', async () => {
    const req = jsonPost('https://x/api/submit', basePayload({ turnstile_token: null }));
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('captcha_failed');
  });

  it('200 при успешной верификации токена', async () => {
    fakeFetch.route('challenges.cloudflare.com', { body: { success: true } });
    const req = jsonPost('https://x/api/submit', basePayload({ turnstile_token: 'OK_TOKEN' }));
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);
    expect(fakeFetch.calls.some(c => c.url.includes('siteverify'))).toBe(true);
  });

  it('403 при invalid токене (success: false)', async () => {
    fakeFetch.route('challenges.cloudflare.com', { body: { success: false, 'error-codes': ['invalid-input-response'] } });
    const req = jsonPost('https://x/api/submit', basePayload({ turnstile_token: 'BAD' }));
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(403);
  });
});
