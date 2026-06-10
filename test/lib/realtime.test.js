import { describe, it, expect, beforeEach, vi } from 'vitest';
import { emitEvent, emitToMany } from '../../functions/_lib/realtime.js';
import { makeFakeDb } from '../helpers/fake-db.js';
import { makeFakeFetch } from '../helpers/fake-fetch.js';

describe('emitEvent', () => {
  let env, fakeFetch;

  beforeEach(() => {
    env = { DB: makeFakeDb() };
    fakeFetch = makeFakeFetch().route('/', { body: { ok: true } });
    fakeFetch.install();
  });

  it('записывает событие в realtime_events', async () => {
    let inserted = null;
    env.DB.on('INSERT INTO realtime_events', { run: (args) => { inserted = args; } });
    await emitEvent(env, 'partner:a_chln_01', 'new_lead', { lead_id: 42 });
    expect(inserted[0]).toBe('partner:a_chln_01');
    expect(inserted[1]).toBe('new_lead');
    expect(JSON.parse(inserted[2])).toEqual({ lead_id: 42 });
  });

  it('без DB не падает', async () => {
    await expect(emitEvent({}, 'partner:x', 'new_lead', {})).resolves.toBeUndefined();
  });

  it('emitToMany эмитит на каждую аудиторию', async () => {
    const audiencesCalled = [];
    env.DB.on('INSERT INTO realtime_events', {
      run: (args) => { audiencesCalled.push(args[0]); }
    });
    await emitToMany(env, ['partner:x', 'owner', 'mr:111'], 'new_lead', { lead_id: 1 });
    expect(audiencesCalled.sort()).toEqual(['mr:111', 'owner', 'partner:x']);
  });

  it('emitToMany пропускает falsy в массиве', async () => {
    const audiencesCalled = [];
    env.DB.on('INSERT INTO realtime_events', {
      run: (args) => { audiencesCalled.push(args[0]); }
    });
    await emitToMany(env, ['owner', null, '', undefined], 'x', {});
    expect(audiencesCalled).toEqual(['owner']);
  });

  it('пушит в worker, если REALTIME_BROADCAST_URL + SHARED_SECRET заданы', async () => {
    env.REALTIME_BROADCAST_URL = 'https://realtime.test/broadcast';
    env.REALTIME_SHARED_SECRET = 'secret';
    env.DB.on('INSERT INTO realtime_events', { run: () => ({}) });

    await emitEvent(env, 'partner:a', 'new_lead', { lead_id: 1 });

    const workerCall = fakeFetch.calls.find(c => c.url.includes('broadcast'));
    expect(workerCall).toBeTruthy();
    expect(workerCall.init.headers['X-Internal-Secret']).toBe('secret');
    const body = JSON.parse(workerCall.init.body);
    expect(body.audience).toBe('partner:a');
    expect(body.event.type).toBe('new_lead');
    expect(body.event.payload.lead_id).toBe(1);
  });

  it('НЕ пушит в worker, если REALTIME_BROADCAST_URL не задан', async () => {
    env.DB.on('INSERT INTO realtime_events', { run: () => ({}) });
    await emitEvent(env, 'partner:a', 'new_lead', { lead_id: 1 });
    const workerCall = fakeFetch.calls.find(c => c.url.includes('broadcast'));
    expect(workerCall).toBeUndefined();
  });
});
