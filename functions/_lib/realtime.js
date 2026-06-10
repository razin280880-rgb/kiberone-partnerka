// Realtime: emit-side helper.
// Записывает событие в realtime_events. Клиенты подхватят через /api/realtime/events.

import { nowSec } from './auth.js';

/**
 * Эмитит событие конкретной аудитории.
 * @param env — Pages env (DB).
 * @param audience — 'partner:slug' | 'owner' | 'mr:tg_id'
 * @param eventType — короткий идентификатор (new_lead / status_changed / ...)
 * @param payload — JSON-сериализуемый объект.
 */
async function emitEvent(env, audience, eventType, payload) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      'INSERT INTO realtime_events (audience, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)'
    ).bind(audience, eventType, JSON.stringify(payload || {}), nowSec()).run();
  } catch (e) {
    console.error('emitEvent error', e);
  }
}

/**
 * Эмитит для нескольких аудиторий разом (parallel).
 * Удобно когда событие интересно и партнёру, и владельцу, и МР.
 */
async function emitToMany(env, audiences, eventType, payload) {
  await Promise.all(audiences.filter(Boolean).map(a => emitEvent(env, a, eventType, payload)));
}

export { emitEvent, emitToMany };
