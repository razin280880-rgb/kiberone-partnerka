// kiberone-realtime — отдельный Worker для WebSocket-канала.
//
// Архитектура:
//   - GET /ws?token=<HMAC_TOKEN>  — клиент открывает WS, валидируем токен,
//     роутим в Durable Object instance по audience (idFromName).
//   - POST /broadcast              — Pages эмитит сюда (с X-Internal-Secret),
//     роутим в DO instance конкретной audience.
//   - GET /health                  — для health-check'а.
//
// DO использует Hibernation API (acceptWebSocket + webSocketMessage handler),
// чтобы инстанс мог выключаться когда нет активности. На больших объёмах
// это снижает стоимость DO units в разы.

import { verifyToken } from './hmac.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check (для мониторинга и тестов).
    if (url.pathname === '/health') {
      return new Response('ok', {
        headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }
      });
    }

    // WebSocket upgrade.
    if (url.pathname === '/ws') {
      return handleWsUpgrade(request, env, url);
    }

    // Broadcast от Pages (внутренний канал).
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return handleBroadcast(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};

// ---------- WebSocket upgrade ----------

async function handleWsUpgrade(request, env, url) {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Expected websocket', { status: 426 });
  }

  const token = url.searchParams.get('token');
  if (!token) return new Response('Missing token', { status: 401 });

  if (!env.REALTIME_SHARED_SECRET) {
    return new Response('Misconfigured: REALTIME_SHARED_SECRET not set', { status: 503 });
  }

  const payload = await verifyToken(env.REALTIME_SHARED_SECRET, token);
  if (!payload) return new Response('Invalid token', { status: 401 });

  // Роутим в DO по audience (одна на каждую "комнату").
  const id = env.HUB.idFromName(payload.audience);
  const stub = env.HUB.get(id);

  // Прокидываем оригинальный request, добавив в URL audience (для логирования в DO).
  const forwardUrl = new URL(request.url);
  forwardUrl.pathname = '/inner/ws';
  forwardUrl.searchParams.set('audience', payload.audience);

  return stub.fetch(forwardUrl.toString(), request);
}

// ---------- Broadcast ----------

async function handleBroadcast(request, env) {
  // Защита: X-Internal-Secret должен совпадать с REALTIME_SHARED_SECRET.
  // Pages вызывает с тем же секретом.
  const sentSecret = request.headers.get('X-Internal-Secret');
  if (!env.REALTIME_SHARED_SECRET || sentSecret !== env.REALTIME_SHARED_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }

  let payload;
  try { payload = await request.json(); }
  catch { return new Response('Bad JSON', { status: 400 }); }

  const { audience, event } = payload;
  if (!audience || !event) {
    return new Response('Missing audience or event', { status: 400 });
  }

  const id = env.HUB.idFromName(audience);
  const stub = env.HUB.get(id);

  const innerUrl = `https://hub.local/inner/broadcast`;
  return stub.fetch(innerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audience, event })
  });
}

// ============== Durable Object class ==============

export class RealtimeHub {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // sessions хранятся через Hibernation API — DO может уйти в сон.
    // Восстанавливаем при следующем запросе через getWebSockets().
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/inner/ws') {
      return this.acceptSession(request, url.searchParams.get('audience'));
    }

    if (url.pathname === '/inner/broadcast' && request.method === 'POST') {
      const { event } = await request.json();
      return this.broadcast(event);
    }

    return new Response('Not found in DO', { status: 404 });
  }

  acceptSession(request, audience) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Hibernation API — DO платит только за активные обработчики.
    // attachment сохраняет метаданные сессии (audience) для восстановления после сна.
    this.state.acceptWebSocket(server, [audience || 'unknown']);

    // Приветственный пакет — клиент видит «канал жив».
    try {
      server.send(JSON.stringify({
        type: '__hello',
        ts: Math.floor(Date.now() / 1000),
        audience
      }));
    } catch (e) { /* ok если уже закрыт */ }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation hooks — Cloudflare вызывает при сообщениях / закрытиях.
  webSocketMessage(ws, message) {
    // Клиент не отправляет нам данные (read-only канал).
    // Но если придёт `ping` — ответим `pong`, чтобы клиент мог держать heartbeat.
    if (typeof message === 'string') {
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Math.floor(Date.now() / 1000) }));
        }
      } catch { /* ignore */ }
    }
  }

  webSocketClose(ws, code, reason, wasClean) {
    // Cloudflare сам удалит ws из state. Здесь можно логировать при желании.
  }

  webSocketError(ws, error) {
    // Аналогично — Cloudflare позаботится. При необходимости логируем.
  }

  async broadcast(event) {
    const sockets = this.state.getWebSockets();
    let sent = 0;
    let failed = 0;
    const message = JSON.stringify(event);
    for (const ws of sockets) {
      try {
        ws.send(message);
        sent++;
      } catch {
        failed++;
      }
    }
    return new Response(
      JSON.stringify({ ok: true, sent, failed }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}
