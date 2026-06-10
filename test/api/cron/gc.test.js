import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestPost } from '../../../functions/api/cron/gc.js';
import { makeEnv } from '../../helpers/fake-env.js';
import { jsonPost } from '../../helpers/fake-request.js';

describe('POST /api/cron/gc', () => {
  let env;

  beforeEach(() => {
    env = makeEnv();
  });

  it('403 без X-Cron-Secret', async () => {
    const req = jsonPost('https://x/api/cron/gc', {});
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(403);
  });

  it('403 при неверном secret', async () => {
    const req = jsonPost('https://x/api/cron/gc', {}, { headers: { 'X-Cron-Secret': 'WRONG' } });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(403);
  });

  it('200 + возвращает счётчики удалений по всем таблицам', async () => {
    // Каждый DELETE возвращает свой счётчик.
    let calls = [];
    env.DB.on('DELETE FROM realtime_events', { run: () => { calls.push('rt'); return { changes: 12 }; } });
    env.DB.on('DELETE FROM otp_codes', { run: () => { calls.push('otp'); return { changes: 3 }; } });
    env.DB.on('DELETE FROM owner_otp', { run: () => { calls.push('owner_otp'); return { changes: 1 }; } });
    env.DB.on('DELETE FROM rate_limits', { run: () => { calls.push('rl'); return { changes: 7 }; } });
    env.DB.on('DELETE FROM sessions', { run: () => { calls.push('sess'); return { changes: 2 }; } });

    const req = jsonPost('https://x/api/cron/gc', {},
      { headers: { 'X-Cron-Secret': 'CRON_TEST_SECRET' } });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.deleted).toEqual({
      realtime_events: 12,
      otp_codes: 3,
      owner_otp: 1,
      rate_limits: 7,
      sessions: 2
    });

    // Все 5 таблиц должны быть тронуты.
    expect(calls.sort()).toEqual(['otp', 'owner_otp', 'rl', 'rt', 'sess']);
  });

  it('503 без DB', async () => {
    env.DB = null;
    const req = jsonPost('https://x/api/cron/gc', {},
      { headers: { 'X-Cron-Secret': 'CRON_TEST_SECRET' } });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(503);
  });

  it('realtime_events чистится за 7 дней, остальные за 1 день', async () => {
    const now = Math.floor(Date.now() / 1000);
    const seenCutoffs = {};
    env.DB.on('DELETE FROM realtime_events', {
      run: (args) => { seenCutoffs.rt = args[0]; return { changes: 0 }; }
    });
    env.DB.on('DELETE FROM otp_codes', {
      run: (args) => { seenCutoffs.otp = args[0]; return { changes: 0 }; }
    });
    env.DB.on('DELETE FROM rate_limits', {
      run: (args) => { seenCutoffs.rl = args[0]; return { changes: 0 }; }
    });
    env.DB.on('DELETE FROM owner_otp', { run: () => ({ changes: 0 }) });
    env.DB.on('DELETE FROM sessions', { run: () => ({ changes: 0 }) });

    const req = jsonPost('https://x/api/cron/gc', {},
      { headers: { 'X-Cron-Secret': 'CRON_TEST_SECRET' } });
    await onRequestPost({ request: req, env });

    // realtime_events: 7 дней назад (±5 сек)
    expect(seenCutoffs.rt).toBeGreaterThan(now - 7 * 24 * 3600 - 5);
    expect(seenCutoffs.rt).toBeLessThan(now - 7 * 24 * 3600 + 5);
    // otp/rl: 1 день назад
    expect(seenCutoffs.otp).toBeGreaterThan(now - 24 * 3600 - 5);
    expect(seenCutoffs.otp).toBeLessThan(now - 24 * 3600 + 5);
    expect(seenCutoffs.rl).toBeGreaterThan(now - 24 * 3600 - 5);
  });
});
