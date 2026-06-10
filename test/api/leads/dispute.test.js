import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestPost } from '../../../functions/api/leads/dispute.js';
import { makeEnv } from '../../helpers/fake-env.js';
import { jsonPost } from '../../helpers/fake-request.js';
import { makeFakeFetch } from '../../helpers/fake-fetch.js';

const SESSION_COOKIE = 'kp_session=VALID_TOKEN';

function bindSession(env, partnerSlug) {
  env.DB.on('SELECT partner_slug, expires_at, role FROM sessions', {
    first: () => ({
      partner_slug: partnerSlug,
      role: 'partner',
      expires_at: Math.floor(Date.now() / 1000) + 3600
    })
  });
  env.DB.on('SELECT last_seen_at FROM sessions WHERE token', {
    first: () => ({ last_seen_at: Math.floor(Date.now() / 1000) - 100 })
  });
}

describe('POST /api/leads/dispute', () => {
  let env, fakeFetch;

  beforeEach(() => {
    env = makeEnv();
    fakeFetch = makeFakeFetch().route('api.telegram.org', { body: { ok: true } });
    fakeFetch.install();
  });

  it('200 + Telegram-уведомление МР при валидном споре', async () => {
    bindSession(env, 'stomat_chln_01');
    env.DB.on('SELECT id, partner_slug, child_age, status, submitted_at FROM leads', {
      first: () => ({
        id: 42,
        partner_slug: 'stomat_chln_01',
        child_age: 9,
        status: 'rejected',
        submitted_at: Math.floor(Date.now() / 1000) - 86400
      })
    });
    env.DB.on('UPDATE leads SET dispute_reason', { run: () => ({ changes: 1 }) });
    env.DB.on('SELECT name, city, mr_name, mr_telegram FROM partners', {
      first: () => ({ name: 'Зубарик', city: 'Челны', mr_name: 'Анна', mr_telegram: '400383551' })
    });

    const req = jsonPost('https://x/api/leads/dispute',
      { lead_id: 42, reason: 'Этот ребёнок уже занимается у вас' },
      { headers: { Cookie: SESSION_COOKIE } }
    );
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);

    const tgCall = fakeFetch.calls.find(c => c.url.includes('sendMessage'));
    expect(tgCall).toBeTruthy();
    const tgBody = JSON.parse(tgCall.init.body);
    expect(tgBody.chat_id).toBe('400383551');
    expect(tgBody.text).toContain('Партнёр оспорил');
    expect(tgBody.text).toContain('Зубарик');
  });

  it('401 без сессии', async () => {
    const req = jsonPost('https://x/api/leads/dispute', { lead_id: 42, reason: 'asdfg' });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(401);
  });

  it('403, если лид принадлежит другому партнёру', async () => {
    bindSession(env, 'stomat_chln_01');
    env.DB.on('SELECT id, partner_slug, child_age, status, submitted_at FROM leads', {
      first: () => ({
        id: 99,
        partner_slug: 'другой_chln_02',
        child_age: 8,
        status: 'rejected',
        submitted_at: 100
      })
    });

    const req = jsonPost('https://x/api/leads/dispute',
      { lead_id: 99, reason: 'asdfg' },
      { headers: { Cookie: SESSION_COOKIE } }
    );
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(403);
  });

  it('404, если лида не существует', async () => {
    bindSession(env, 'stomat_chln_01');
    env.DB.on('SELECT id, partner_slug, child_age, status, submitted_at FROM leads', {
      first: () => null
    });

    const req = jsonPost('https://x/api/leads/dispute',
      { lead_id: 9999, reason: 'asdfg' },
      { headers: { Cookie: SESSION_COOKIE } }
    );
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(404);
  });

  it('400 при слишком короткой причине', async () => {
    bindSession(env, 'stomat_chln_01');
    const req = jsonPost('https://x/api/leads/dispute',
      { lead_id: 1, reason: 'no' },
      { headers: { Cookie: SESSION_COOKIE } }
    );
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });
});
