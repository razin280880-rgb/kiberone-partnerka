import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { rateLimit, getIP } from '../../functions/_lib/ratelimit.js';
import { makeFakeDb } from '../helpers/fake-db.js';
import { makeRequest } from '../helpers/fake-request.js';

describe('rateLimit', () => {
  let env;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T10:00:00Z'));
    env = { DB: makeFakeDb() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('пропускает первый запрос и создаёт окно', async () => {
    let inserted = null;
    env.DB.on('SELECT window_start', { first: () => null });
    env.DB.on('INSERT INTO rate_limits', { run: (args) => { inserted = args; return { changes: 1 }; } });

    const r = await rateLimit(env, 'scan:1.2.3.4', 100, 3600);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(99);
    expect(inserted[0]).toBe('scan:1.2.3.4');
  });

  it('инкрементирует счётчик внутри окна', async () => {
    let updated = false;
    env.DB.on('SELECT window_start', {
      first: () => ({ window_start: Math.floor(Date.now() / 1000) - 100, count: 5 })
    });
    env.DB.on('UPDATE rate_limits SET count = count + 1', {
      run: () => { updated = true; return { changes: 1 }; }
    });

    const r = await rateLimit(env, 'scan:1.2.3.4', 100, 3600);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(94);
    expect(updated).toBe(true);
  });

  it('блокирует, когда лимит достигнут', async () => {
    env.DB.on('SELECT window_start', {
      first: () => ({ window_start: Math.floor(Date.now() / 1000) - 100, count: 100 })
    });

    const r = await rateLimit(env, 'scan:1.2.3.4', 100, 3600);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
    expect(r.retryAfter).toBeLessThanOrEqual(3500);
  });

  it('перезапускает окно после истечения', async () => {
    let updated = null;
    env.DB.on('SELECT window_start', {
      first: () => ({ window_start: Math.floor(Date.now() / 1000) - 7200, count: 999 })
    });
    env.DB.on('UPDATE rate_limits SET window_start', {
      run: (args) => { updated = args; return { changes: 1 }; }
    });

    const r = await rateLimit(env, 'scan:1.2.3.4', 100, 3600);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(99);
    expect(updated).toBeTruthy();
  });

  it('без DB пропускает всё (offline-safe)', async () => {
    const r = await rateLimit({}, 'scan:1.2.3.4', 100, 3600);
    expect(r.ok).toBe(true);
  });
});

describe('getIP', () => {
  it('берёт CF-Connecting-IP в первую очередь', () => {
    const req = makeRequest('https://x', { ip: '9.9.9.9' });
    expect(getIP(req)).toBe('9.9.9.9');
  });

  it('фолбэк на X-Forwarded-For (берёт первый IP)', () => {
    const req = new Request('https://x', {
      headers: { 'X-Forwarded-For': '5.5.5.5, 6.6.6.6' }
    });
    expect(getIP(req)).toBe('5.5.5.5');
  });

  it('"unknown" если ничего нет', () => {
    const req = new Request('https://x');
    expect(getIP(req)).toBe('unknown');
  });
});
