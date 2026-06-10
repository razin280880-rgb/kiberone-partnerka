import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestGet } from '../../../functions/api/realtime/ws-token.js';
import { makeEnv } from '../../helpers/fake-env.js';
import { makeRequest } from '../../helpers/fake-request.js';

const SESSION_COOKIE = 'kp_session=TOK';

function bindSession(env, role, slug) {
  env.DB.on('SELECT partner_slug, expires_at, role FROM sessions', {
    first: () => ({
      partner_slug: slug, role,
      expires_at: Math.floor(Date.now() / 1000) + 3600
    })
  });
  env.DB.on('SELECT last_seen_at FROM sessions', {
    first: () => ({ last_seen_at: Math.floor(Date.now() / 1000) })
  });
}

describe('GET /api/realtime/ws-token', () => {
  let env;

  beforeEach(() => {
    env = makeEnv({
      REALTIME_SHARED_SECRET: 'test-secret',
      REALTIME_WS_URL: 'wss://realtime.example/ws'
    });
  });

  it('401 без сессии', async () => {
    const req = makeRequest('https://x/api/realtime/ws-token');
    const res = await onRequestGet({ request: req, env });
    expect(res.status).toBe(401);
  });

  it('503 если realtime-worker не сконфигурирован', async () => {
    env.REALTIME_SHARED_SECRET = '';
    bindSession(env, 'partner', 'a_chln_01');
    const req = makeRequest('https://x/api/realtime/ws-token', {
      headers: { Cookie: SESSION_COOKIE }
    });
    const res = await onRequestGet({ request: req, env });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('realtime_disabled');
  });

  it('partner получает токен с audience=partner:<slug>', async () => {
    bindSession(env, 'partner', 'stomat_chln_01');
    const req = makeRequest('https://x/api/realtime/ws-token', {
      headers: { Cookie: SESSION_COOKIE }
    });
    const res = await onRequestGet({ request: req, env });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.audience).toBe('partner:stomat_chln_01');
    expect(data.wsUrl).toBe('wss://realtime.example/ws');
    expect(data.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(data.expiresIn).toBe(300);
  });

  it('owner получает токен с audience=owner', async () => {
    bindSession(env, 'owner', '__owner__');
    const req = makeRequest('https://x/api/realtime/ws-token', {
      headers: { Cookie: SESSION_COOKIE }
    });
    const res = await onRequestGet({ request: req, env });
    const data = await res.json();
    expect(data.audience).toBe('owner');
  });
});
