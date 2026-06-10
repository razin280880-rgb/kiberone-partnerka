import { describe, it, expect, beforeEach } from 'vitest';
import { onRequestPost } from '../../../functions/api/cron/weekly-summary.js';
import { makeEnv } from '../../helpers/fake-env.js';
import { jsonPost } from '../../helpers/fake-request.js';
import { makeFakeFetch } from '../../helpers/fake-fetch.js';

describe('POST /api/cron/weekly-summary', () => {
  let env, fakeFetch;

  beforeEach(() => {
    env = makeEnv();
    fakeFetch = makeFakeFetch().route('api.telegram.org', { body: { ok: true } });
    fakeFetch.install();
  });

  it('403 без X-Cron-Secret', async () => {
    const req = jsonPost('https://x/api/cron/weekly-summary', {});
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(403);
  });

  it('403 при неправильном secret', async () => {
    const req = jsonPost('https://x/api/cron/weekly-summary', {}, {
      headers: { 'X-Cron-Secret': 'WRONG' }
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(403);
  });

  it('200 + рассылает сводку каждому привязанному партнёру', async () => {
    env.DB.on('FROM partners p\n       JOIN telegram_bindings', {
      all: () => [
        { slug: 'a_chln_01', name: 'A', city: 'Челны', telegram_user_id: 1001 },
        { slug: 'b_chln_02', name: 'B', city: 'Челны', telegram_user_id: 1002 }
      ]
    });
    // Метрики и сканы — два вызова на партнёра × 2 партнёра = 4.
    env.DB.on('FROM leads WHERE partner_slug = ?', {
      first: () => ({ leads: 5, trials: 2, paid: 1, amount: 3500 })
    });
    env.DB.on('FROM scans WHERE partner_slug = ?', {
      first: () => ({ cnt: 23 })
    });

    const req = jsonPost('https://x/api/cron/weekly-summary', {}, {
      headers: { 'X-Cron-Secret': 'CRON_TEST_SECRET' }
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sent).toBe(2);
    expect(data.errors).toBe(0);

    const tgCalls = fakeFetch.calls.filter(c => c.url.includes('sendMessage'));
    expect(tgCalls.length).toBe(2);
    const chatIds = tgCalls.map(c => JSON.parse(c.init.body).chat_id).sort();
    expect(chatIds).toEqual([1001, 1002]);
  });

  it('503, если TELEGRAM_BOT_TOKEN не настроен', async () => {
    env.TELEGRAM_BOT_TOKEN = '';
    const req = jsonPost('https://x/api/cron/weekly-summary', {}, {
      headers: { 'X-Cron-Secret': 'CRON_TEST_SECRET' }
    });
    const res = await onRequestPost({ request: req, env });
    expect(res.status).toBe(503);
  });
});
