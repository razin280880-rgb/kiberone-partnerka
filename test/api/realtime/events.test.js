import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestGet } from '../../../functions/api/realtime/events.js';
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

describe('GET /api/realtime/events', () => {
  let env;

  beforeEach(() => {
    env = makeEnv();
  });

  it('401 без сессии', async () => {
    const req = makeRequest('https://x/api/realtime/events?since=0');
    const res = await onRequestGet({ request: req, env });
    expect(res.status).toBe(401);
  });

  it('partner получает события partner:<slug>, не owner', async () => {
    bindSession(env, 'partner', 'stomat_chln_01');
    let capturedBindings = null;
    env.DB.on('FROM realtime_events', {
      all: (args) => {
        capturedBindings = args;
        return [
          { id: 1, audience: 'partner:stomat_chln_01', event_type: 'new_lead',
            payload_json: '{"lead_id":42,"child_age":9}',
            created_at: Math.floor(Date.now() / 1000) }
        ];
      }
    });

    const req = makeRequest('https://x/api/realtime/events?since=100', {
      headers: { Cookie: SESSION_COOKIE }
    });
    const res = await onRequestGet({ request: req, env });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(capturedBindings[0]).toBe('partner:stomat_chln_01');  // только своя аудитория
    expect(data.events).toHaveLength(1);
    expect(data.events[0].type).toBe('new_lead');
    expect(data.events[0].payload.lead_id).toBe(42);
    expect(data.nextSince).toBe(data.events[0].ts);
  });

  it('owner получает события owner-аудитории', async () => {
    bindSession(env, 'owner', '__owner__');
    let capturedBindings = null;
    env.DB.on('FROM realtime_events', {
      all: (args) => { capturedBindings = args; return []; }
    });

    const req = makeRequest('https://x/api/realtime/events?since=0', {
      headers: { Cookie: SESSION_COOKIE }
    });
    const res = await onRequestGet({ request: req, env });
    expect(res.status).toBe(200);
    expect(capturedBindings[0]).toBe('owner');
  });

  it('serverTs всегда возвращается (для устойчивого нового since)', async () => {
    bindSession(env, 'partner', 'a');
    env.DB.on('FROM realtime_events', { all: () => [] });
    const req = makeRequest('https://x/api/realtime/events?since=0', {
      headers: { Cookie: SESSION_COOKIE }
    });
    const res = await onRequestGet({ request: req, env });
    const data = await res.json();
    expect(data.serverTs).toBeGreaterThan(0);
    expect(data.nextSince).toBeGreaterThan(0);
  });

  it('пустой результат корректен', async () => {
    bindSession(env, 'partner', 'a');
    env.DB.on('FROM realtime_events', { all: () => [] });
    const req = makeRequest('https://x/api/realtime/events?since=0', {
      headers: { Cookie: SESSION_COOKIE }
    });
    const res = await onRequestGet({ request: req, env });
    const data = await res.json();
    expect(data.events).toEqual([]);
  });
});
