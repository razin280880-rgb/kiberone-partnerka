// Realtime emit: пишет в D1 (для polling-fallback и истории) + параллельно
// уведомляет realtime-worker (для мгновенной доставки через WebSocket).
//
// Оба шага опциональны:
// - Без D1: ничего не пишем (polling-клиенты не получат).
// - Без REALTIME_BROADCAST_URL / REALTIME_SHARED_SECRET: WS-клиенты получат
//   через 5 сек (как polling fallback).

import { nowSec } from './auth.js';

async function writeToD1(env, audience, eventType, payload) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      'INSERT INTO realtime_events (audience, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)'
    ).bind(audience, eventType, JSON.stringify(payload || {}), nowSec()).run();
  } catch (e) {
    console.error('emit→D1 error', e);
  }
}

async function pushToWorker(env, audience, eventType, payload) {
  if (!env.REALTIME_BROADCAST_URL || !env.REALTIME_SHARED_SECRET) return;
  const event = {
    type: eventType,
    payload: payload || {},
    ts: nowSec()
  };
  try {
    // Используем waitUntil-friendly fetch — не ждём ответа сильно, но даём Workers
    // дойти до конца, а не оборваться на закрытии Request scope.
    const r = await fetch(env.REALTIME_BROADCAST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': env.REALTIME_SHARED_SECRET
      },
      body: JSON.stringify({ audience, event })
    });
    if (!r.ok) console.warn('emit→worker non-ok', r.status);
  } catch (e) {
    console.error('emit→worker error', e);
  }
}

/**
 * Эмит на одну аудиторию.
 */
async function emitEvent(env, audience, eventType, payload) {
  // Параллельно — обе доставки независимы.
  await Promise.all([
    writeToD1(env, audience, eventType, payload),
    pushToWorker(env, audience, eventType, payload)
  ]);
}

/**
 * Эмит на несколько аудиторий разом.
 */
async function emitToMany(env, audiences, eventType, payload) {
  await Promise.all(
    audiences.filter(Boolean).map(a => emitEvent(env, a, eventType, payload))
  );
}

export { emitEvent, emitToMany };
