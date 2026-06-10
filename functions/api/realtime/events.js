// GET /api/realtime/events?since=<unix_ts>
//
// Возвращает события для текущего пользователя с момента since (unix-секунды).
// Аудитория определяется автоматически из сессии:
//   - owner → 'owner'
//   - partner → 'partner:<slug>'
//
// Клиент поллит каждые 5 секунд: GET с since = последний полученный ts.
// При первом запросе — since = текущее время-1 (получаем «сейчас и позже»).

import { jsonResponse, readSession, nowSec } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const session = await readSession(env, request);
  if (!session) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  if (!env.DB) return jsonResponse({ events: [], serverTs: nowSec() });

  const url = new URL(request.url);
  const since = parseInt(url.searchParams.get('since') || '0', 10) || (nowSec() - 60);

  // Аудитории, которые видит этот пользователь.
  const audiences = session.role === 'owner'
    ? ['owner']
    : [`partner:${session.partner_slug}`];

  // Безопасно собираем placeholders для IN (?, ?, ?...).
  const placeholders = audiences.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT id, audience, event_type, payload_json, created_at
       FROM realtime_events
      WHERE audience IN (${placeholders}) AND created_at > ?
   ORDER BY created_at ASC
      LIMIT 100`
  ).bind(...audiences, since).all();

  const events = (results || []).map(r => ({
    id: r.id,
    type: r.event_type,
    payload: safeParse(r.payload_json),
    ts: r.created_at
  }));

  return jsonResponse({
    events,
    serverTs: nowSec(),
    nextSince: events.length ? events[events.length - 1].ts : nowSec()
  });
}

function safeParse(s) {
  try { return JSON.parse(s); }
  catch { return {}; }
}
