/* === Realtime client ===
 * Поллит /api/realtime/events каждые 5 сек, показывает toast,
 * вызывает callback'и подписчиков. Останавливается, когда вкладка скрыта.
 */

(function () {
  'use strict';

  const POLL_INTERVAL_MS = 5000;
  const POLL_INTERVAL_BG_MS = 30000;  // когда вкладка скрыта — реже

  const handlers = new Map();  // event_type → Set<callback>
  let lastTs = 0;
  let timer = null;
  let stopped = false;

  function on(eventType, fn) {
    if (!handlers.has(eventType)) handlers.set(eventType, new Set());
    handlers.get(eventType).add(fn);
    return () => handlers.get(eventType).delete(fn);
  }

  function emit(event) {
    const set = handlers.get(event.type);
    if (set) for (const fn of set) {
      try { fn(event); } catch (e) { console.error('realtime handler error', e); }
    }
    const allSet = handlers.get('*');
    if (allSet) for (const fn of allSet) { try { fn(event); } catch {} }
  }

  async function poll() {
    if (stopped) return;
    try {
      const r = await fetch(`/api/realtime/events?since=${lastTs}`, { credentials: 'same-origin' });
      if (r.status === 401) {
        // Сессия истекла — пусть guard на странице сам отредиректит.
        stop();
        return;
      }
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data.events) && data.events.length) {
          for (const ev of data.events) emit(ev);
        }
        lastTs = data.nextSince || data.serverTs || lastTs;
      }
    } catch (e) { /* network blip — ok, перепробуем через интервал */ }
    schedule();
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    const delay = document.hidden ? POLL_INTERVAL_BG_MS : POLL_INTERVAL_MS;
    timer = setTimeout(poll, delay);
  }

  function start() {
    stopped = false;
    // Первое окно — последние 60 сек (на случай переподключения).
    lastTs = Math.floor(Date.now() / 1000) - 60;
    poll();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        // Сразу опросим при возврате к вкладке — пользователь хочет видеть свежее.
        poll();
      } else {
        schedule();
      }
    });
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
  }

  // ---------- Toast (DOM-инжектится при первом showToast) ----------
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
    // Анимация появления через next frame.
    requestAnimationFrame(() => el.classList.add('rt-toast-show'));
    setTimeout(() => {
      el.classList.remove('rt-toast-show');
      setTimeout(() => el.remove(), 300);
    }, ttl);
  }

  window.Realtime = { start, stop, on, showToast };
})();
