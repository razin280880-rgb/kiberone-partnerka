import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestPost } from '../../../functions/api/admin/disputes/resolve.js';
import { makeEnv } from '../../helpers/fake-env.js';
import { jsonPost } from '../../helpers/fake-request.js';
import { makeFakeFetch } from '../../helpers/fake-fetch.js';

const SESSION_COOKIE = 'kp_session=OWNER_TOK';

function bindOwnerSession(env) {
  env.DB.on('SELECT partner_slug, expires_at, role FROM sessions', {
    first: () => ({ partner_slug: '__owner__', role: 'owner',
                     expires_at: Math.floor(Date.now() / 1000) + 3600 })
  });
  env.DB.on('SELECT last_seen_at FROM sessions', {
    first: () => ({ last_seen_at: Math.floor(Date.now() / 1000) })
  });
}

describe('POST /api/admin/disputes/resolve', () => {
  let env, fakeFetch;

  beforeEach(() => {
    env = makeEnv();
    fakeFetch = makeFakeFetch().route('api.telegram.org', { body: { ok: true } });
    fakeFetch.install();
  });

  it('401 без сессии', async () => {
    const req = jsonPost('https://x/api/admin/disputes/resolve', { lead_id: 1, action: 'accept' });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(401);
  });

  it('403 для partner-сессии', async () => {
    env.DB.on('SELECT partner_slug, expires_at, role FROM sessions', {
      first: () => ({ partner_slug: 'x', role: 'partner', expires_at: Math.floor(Date.now() / 1000) + 3600 })
    });
    env.DB.on('SELECT last_seen_at FROM sessions', { first: () => ({ last_seen_at: 1 }) });
    const req = jsonPost('https://x/api/admin/disputes/resolve',
      { lead_id: 1, action: 'accept' }, { headers: { Cookie: SESSION_COOKIE } });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(403);
  });

  it('400 при неверном action', async () => {
    bindOwnerSession(env);
    const req = jsonPost('https://x/api/admin/disputes/resolve',
      { lead_id: 1, action: 'maybe' }, { headers: { Cookie: SESSION_COOKIE } });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(400);
  });

  it('404 для несуществующего лида', async () => {
    bindOwnerSession(env);
    env.DB.on('FROM leads WHERE id = ?', { first: () => null });
    const req = jsonPost('https://x/api/admin/disputes/resolve',
      { lead_id: 999, action: 'accept' }, { headers: { Cookie: SESSION_COOKIE } });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(404);
  });

  it('accept: обнуляет начисления, статус → rejected, уведомление партнёру', async () => {
    bindOwnerSession(env);
    env.DB.on('FROM leads WHERE id = ?', {
      first: () => ({ id: 42, partner_slug: 'a_chln_01', status: 'qualified',
                       dispute_reason: 'дубль' })
    });
    let updateSql = null, updateArgs = null;
    env.DB.on('UPDATE leads SET status = \'rejected\'', {
      run: (args, sql) => { updateSql = sql; updateArgs = args; return { changes: 1 }; }
    });
    env.DB.on('INSERT INTO admin_log', { run: () => ({}) });
    env.DB.on('FROM telegram_bindings WHERE partner_slug', {
      first: () => ({ telegram_user_id: 12345 })
    });

    const req = jsonPost('https://x/api/admin/disputes/resolve',
      { lead_id: 42, action: 'accept', note: 'согласен с партнёром' },
      { headers: { Cookie: SESSION_COOKIE } });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);
    expect((await res.json()).action).toBe('accept');
    expect(updateSql).toContain('reward_anketa = 0');
    expect(updateSql).toContain('dispute_reason = NULL');

    const tgCall = fakeFetch.calls.find(c => c.url.includes('sendMessage'));
    expect(tgCall).toBeTruthy();
    expect(JSON.parse(tgCall.init.body).text).toContain('принят');
  });

  it('reject: только сбрасывает dispute_reason, начисления остаются', async () => {
    bindOwnerSession(env);
    env.DB.on('FROM leads WHERE id = ?', {
      first: () => ({ id: 50, partner_slug: 'a_chln_01', status: 'qualified', dispute_reason: 'спор' })
    });
    let rejectSql = null;
    env.DB.on('UPDATE leads SET dispute_reason = NULL', {
      run: (args, sql) => { rejectSql = sql; return { changes: 1 }; }
    });
    env.DB.on('INSERT INTO admin_log', { run: () => ({}) });
    env.DB.on('FROM telegram_bindings WHERE partner_slug', { first: () => null });

    const req = jsonPost('https://x/api/admin/disputes/resolve',
      { lead_id: 50, action: 'reject' }, { headers: { Cookie: SESSION_COOKIE } });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);
    expect(rejectSql).toContain('dispute_reason = NULL');
    expect(rejectSql).not.toContain('reward_anketa = 0');
  });
});
