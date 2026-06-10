import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestGet } from '../../../functions/api/admin/overview.js';
import { makeEnv } from '../../helpers/fake-env.js';
import { makeRequest } from '../../helpers/fake-request.js';

const SESSION_COOKIE = 'kp_session=OWNER_TOK';

describe('GET /api/admin/overview', () => {
  let env;

  beforeEach(() => {
    env = makeEnv();
  });

  it('401 без сессии', async () => {
    const req = makeRequest('https://x/api/admin/overview');
    const res = await onRequestGet({ request: req, env });
    expect(res.status).toBe(401);
  });

  it('403 для partner-сессии (защита от horizontal-escalation)', async () => {
    env.DB.on('SELECT partner_slug, expires_at, role FROM sessions', {
      first: () => ({ partner_slug: 'stomat_chln_01', role: 'partner',
                       expires_at: Math.floor(Date.now() / 1000) + 3600 })
    });
    env.DB.on('SELECT last_seen_at FROM sessions', {
      first: () => ({ last_seen_at: Math.floor(Date.now() / 1000) })
    });
    const req = makeRequest('https://x/api/admin/overview', { headers: { Cookie: SESSION_COOKIE } });
    const res = await onRequestGet({ request: req, env });
    expect(res.status).toBe(403);
  });

  it('200 + полная структура для owner-сессии', async () => {
    // session
    env.DB.on('SELECT partner_slug, expires_at, role FROM sessions', {
      first: () => ({ partner_slug: '__owner__', role: 'owner',
                       expires_at: Math.floor(Date.now() / 1000) + 3600 })
    });
    env.DB.on('SELECT last_seen_at FROM sessions', {
      first: () => ({ last_seen_at: Math.floor(Date.now() / 1000) })
    });
    // city queries (3 разных)
    env.DB.on('FROM leads\n      WHERE city = ?', { first: () => ({ leads: 5, trials: 2, paid: 1, amount: 3500 }) });
    env.DB.on('FROM scans\n      WHERE partner_slug LIKE ?', { first: () => ({ scans: 20 }) });
    env.DB.on('FROM partners WHERE city = ?', { first: () => ({ active_partners: 3 }) });
    // top / bottom / dynamics / disputes / mrs
    env.DB.on('FROM partners p\n       LEFT JOIN leads l ON l.partner_slug = p.slug AND l.submitted_at', {
      all: () => [{ slug: 'a', name: 'A', city: 'chln', leads: 10, paid: 2 }]
    });
    env.DB.on('FROM partners p\n      WHERE p.status', {
      all: () => [{ slug: 'b', name: 'B', city: 'kzn', last_lead: 0 }]
    });
    env.DB.on('FROM leads WHERE submitted_at >= ? AND submitted_at < ?', {
      first: () => ({ leads: 7, paid: 1, amount: 3000 })
    });
    env.DB.on("dispute_reason IS NOT NULL", { first: () => ({ cnt: 2 }) });
    env.DB.on('FROM partners p\n       LEFT JOIN leads l ON l.partner_slug = p.slug\n          AND l.submitted_at', {
      all: () => [{ mr_name: 'Анна', mr_telegram: '111', partners: 5, leads: 30, paid: 4 }]
    });

    const req = makeRequest('https://x/api/admin/overview?period=week', {
      headers: { Cookie: SESSION_COOKIE }
    });
    const res = await onRequestGet({ request: req, env });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cities).toHaveLength(7);
    expect(data.total.scans).toBeGreaterThan(0);
    expect(data.dynamics12w).toHaveLength(12);
    expect(data.activeDisputes).toBe(2);
    expect(data.topPartners).toBeInstanceOf(Array);
    expect(data.mrs).toBeInstanceOf(Array);
  });
});
