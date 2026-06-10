import { describe, it, expect, beforeEach, vi } from 'vitest';
import { onRequestPost } from '../../functions/api/scan.js';
import { makeEnv } from '../helpers/fake-env.js';
import { jsonPost } from '../helpers/fake-request.js';

describe('POST /api/scan', () => {
  let env;

  beforeEach(() => {
    env = makeEnv();
  });

  it('сохраняет скан и возвращает ok', async () => {
    let inserted = null;
    env.DB.on('INSERT INTO scans', { run: (args) => { inserted = args; } });
    env.DB.on('SELECT window_start', { first: () => null });
    env.DB.on('INSERT INTO rate_limits', { run: () => ({}) });

    const req = jsonPost('https://x/api/scan', {
      partner_slug: 'stomat_chln_01',
      session_id: 'sess_abc',
      ua: 'Mozilla/Test'
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(inserted[0]).toBe('stomat_chln_01');
    expect(inserted[1]).toBe('sess_abc');
    expect(inserted[3]).toBe('1.2.3.4');  // IP
  });

  it('400 при отсутствии partner_slug', async () => {
    const req = jsonPost('https://x/api/scan', { session_id: 'x' });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });

  it('429 при превышении rate-limit', async () => {
    env.DB.on('SELECT window_start', {
      first: () => ({ window_start: Math.floor(Date.now() / 1000) - 60, count: 100 })
    });
    const req = jsonPost('https://x/api/scan', {
      partner_slug: 'a_chln_01',
      session_id: 'sess_x'
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toBe('rate_limited');
    expect(data.retryAfter).toBeGreaterThan(0);
  });
});
