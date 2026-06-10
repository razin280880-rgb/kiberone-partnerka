// GET /api/realtime/ws-token
//
// Возвращает подписанный токен для WebSocket-аутентификации в realtime-worker.
// Клиент: GET → получает { token, wsUrl } → открывает new WebSocket(wsUrl + '?token=' + token).
//
// Аудитория определяется из сессии (так же как в polling-endpoint):
//   - owner  → 'owner'
//   - partner → 'partner:<slug>'
//
// TTL короткий (5 мин) — клиент перезапросит при reconnect.

import { jsonResponse, readSession } from '../../_lib/auth.js';
import { signToken } from '../../_lib/hmac.js';

const TOKEN_TTL_SEC = 300;

export async function onRequestGet({ request, env }) {
  const session = await readSession(env, request);
  if (!session) return jsonResponse({ error: 'unauthorized' }, { status: 401 });

  if (!env.REALTIME_SHARED_SECRET || !env.REALTIME_WS_URL) {
    return jsonResponse({
      error: 'realtime_disabled',
      message: 'Server: REALTIME_SHARED_SECRET / REALTIME_WS_URL not configured. Fallback to polling.'
    }, { status: 503 });
  }

  const audience = session.role === 'owner'
    ? 'owner'
    : `partner:${session.partner_slug}`;

  const token = await signToken(env.REALTIME_SHARED_SECRET, {
    audience,
    ttlSec: TOKEN_TTL_SEC
  });

  return jsonResponse({
    token,
    wsUrl: env.REALTIME_WS_URL,           // e.g. "wss://realtime-partner.it-kiber.ru/ws"
    expiresIn: TOKEN_TTL_SEC,
    audience
  });
}
