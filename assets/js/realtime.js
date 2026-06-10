/* === Realtime client ===
 * Стратегия: WS first (через realtime-worker), polling fallback автоматический.
 *
 * Жизненный цикл:
 *   1. start() → GET /api/realtime/ws-token
 *   2a. Если 200 → открываем WebSocket с токеном.
 *       При disconnect: reconnect с экспоненциальным backoff (1, 2, 4, 8, 16, 30 сек).
 *       После 6 неудачных попыток → переключаемся на polling (графический fallback).
 *   2b. Если 503/неудача → сразу polling.
 *   3. Page Visibility: при скрытой вкладке — WS оставляем (Cloudflare сам прибьёт inactive),
 *      polling замедляется до 30 сек.
 *
 * Pub/sub API совместим с прошлой версией: window.Realtime.on('new_lead', cb).
 */

(function () {
  'use strict';

  const POLL_INTERVAL_MS = 5000;
  const POLL_INTERVAL_BG_MS = 30000;
  const WS_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
  const WS_HEARTBEAT_MS = 45000;
  const TOKEN_REFRESH_MARGIN_SEC = 30;

  const handlers = new Map();
  let lastTs = 0;
  let pollTimer = null;
  let stopped = false;

  // ---- WS state ----
  let ws = null;
  let wsReconnectAttempt = 0;
  let wsReconnectTimer = null;
  let wsHeartbeatTimer = null;
  let wsMode = 'idle';   // 'idle' | 'ws' | 'polling'
  let tokenInfo = null;  // { token, wsUrl, expiresIn, audience, fetchedAt }

  // ---- Pub/sub ----
  function on(eventType, fn) {
    if (!handlers.has(eventType)) handlers.set(eventType, new Set());
    handlers.get(eventType).add(fn);
    return () => handlers.get(eventType).delete(fn);
  }

  function emit(event) {
    if (!event || !event.type || event.type.startsWith('__')) return;
    const set = handlers.get(event.type);
    if (set) for (const fn of set) {
      try { fn(event); } catch (e) { console.error('realtime handler error', e); }
    }
    const all = handlers.get('*');
    if (all) for (const fn of all) { try { fn(event); } catch {} }
  }

  // ---- Token ----
  async function fetchToken() {
    const r = await fetch('/api/realtime/ws-token', { credentials: 'same-origin' });
    if (r.status === 401) { stop(); return null; }
    if (r.status === 503) return null;  // worker disabled → polling
    if (!r.ok) return null;
    const data = await r.json();
    tokenInfo = { ...data, fetchedAt: Date.now() };
    return tokenInfo;
  }

  function tokenIsFresh() {
    if (!tokenInfo) return false;
    const ageSec = (Date.now() - tokenInfo.fetchedAt) / 1000;
    return ageSec < tokenInfo.expiresIn - TOKEN_REFRESH_MARGIN_SEC;
  }

  // ---- WebSocket ----
  async function connectWs() {
    if (stopped) return;
    if (!tokenIsFresh()) {
      const info = await fetchToken();
      if (!info) { startPolling(); return; }
    }
    cleanupWs();
    const url = tokenInfo.wsUrl + (tokenInfo.wsUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(tokenInfo.token);
    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.warn('WebSocket ctor failed, fallback to polling', e);
      startPolling();
      return;
    }

    ws.onopen = () => {
      wsMode = 'ws';
      wsReconnectAttempt = 0;
      stopPolling();
      startHeartbeat();
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.type === '__hello') return;
        if (event.type === 'pong') return;
        emit(event);
        if (event.ts) lastTs = Math.max(lastTs, event.ts);
      } catch (err) { console.warn('bad WS message', err); }
    };

    ws.onclose = () => {
      wsMode = 'idle';
      stopHeartbeat();
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.warn('WS error', e);
      // onclose всегда сработает следом, реконнект там.
    };
  }

  function cleanupWs() {
    if (ws) {
      try { ws.onmessage = null; ws.onclose = null; ws.onerror = null; ws.close(); } catch {}
      ws = null;
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    if (wsReconnectAttempt >= WS_RECONNECT_DELAYS.length) {
      // Сдаёмся, переходим на polling. Будем раз в 5 мин пробовать WS снова.
      startPolling();
      setTimeout(() => { wsReconnectAttempt = 0; connectWs(); }, 5 * 60 * 1000);
      return;
    }
    const delay = WS_RECONNECT_DELAYS[wsReconnectAttempt++];
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(connectWs, delay);
    // Параллельно polling — пользователь получает события, пока WS не вернётся.
    if (wsMode !== 'polling') startPolling();
  }

  function startHeartbeat() {
    stopHeartbeat();
    wsHeartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
      }
    }, WS_HEARTBEAT_MS);
  }
  function stopHeartbeat() { clearInterval(wsHeartbeatTimer); wsHeartbeatTimer = null; }

  // ---- Polling (fallback / safety net) ----
  async function pollOnce() {
    if (stopped) return;
    try {
      const r = await fetch(`/api/realtime/events?since=${lastTs}`, { credentials: 'same-origin' });
      if (r.status === 401) { stop(); return; }
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.events)) for (const ev of data.events) emit(ev);
        lastTs = data.nextSince || data.serverTs || lastTs;
      }
    } catch (e) { /* network blip */ }
    schedulePoll();
  }

  function schedulePoll() {
    if (stopped) return;
    clearTimeout(pollTimer);
    const delay = document.hidden ? POLL_INTERVAL_BG_MS : POLL_INTERVAL_MS;
    pollTimer = setTimeout(pollOnce, delay);
  }

  function startPolling() {
    if (wsMode === 'polling') return;
    wsMode = 'polling';
    pollOnce();
  }
  function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

  // ---- Lifecycle ----
  function start() {
    stopped = false;
    lastTs = Math.floor(Date.now() / 1000) - 60;
    connectWs();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && wsMode === 'polling') pollOnce();
    });
  }

  function stop() {
    stopped = true;
    cleanupWs();
    stopPolling();
    stopHeartbeat();
    clearTimeout(wsReconnectTimer);
  }

  // ---- Toast ----
  let toastContainer = null;
  function ensureToastContainer() {
    if (toastContainer) return toastContainer;
    toastContainer = document.createElement('div');
    toastContainer.className = 'rt-toast-container';
    document.body.appendChild(toastContainer);
    return toastContainer;
  }
  function showToast(text, kind = 'info', ttl = 5000) {
    const el = document.createElement('div');
    el.className = 'rt-toast rt-toast-' + kind;
    el.textContent = text;
    ensureToastContainer().appendChild(el);
    requestAnimationFrame(() => el.classList.add('rt-toast-show'));
    setTimeout(() => {
      el.classList.remove('rt-toast-show');
      setTimeout(() => el.remove(), 300);
    }, ttl);
  }

  // Для debug: возможность узнать текущий режим.
  function status() {
    return {
      mode: wsMode,
      wsReady: ws?.readyState,
      attempt: wsReconnectAttempt,
      tokenAudience: tokenInfo?.audience
    };
  }

  window.Realtime = { start, stop, on, showToast, status };
})();
