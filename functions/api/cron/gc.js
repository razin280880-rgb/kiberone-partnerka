// POST /api/cron/gc
// Триггер: GitHub Actions ежедневно 03:00 UTC (06:00 МСК) — низкая нагрузка.
// Защита: X-Cron-Secret = env.CRON_SECRET.
//
// Что чистим (всё безопасно — короткоживущие данные):
//   realtime_events  старше 7 дней   — клиент уже их видел, истории не нужно
//   otp_codes        consumed=1 старше 1 дня — токены уже использованы / просрочены
//   owner_otp        consumed=1 старше 1 дня
//   rate_limits      window_start старше 1 дня — окна устарели, можно стартовать с нуля
//
// Что НЕ трогаем:
//   leads, scans, partners, sessions, payouts, admin_log — бизнес-данные.
//   sessions GCится естественно через expires_at в readSession.

import { jsonResponse, nowSec } from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const secret = request.headers.get('X-Cron-Secret');
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return jsonResponse({ error: 'forbidden' }, { status: 403 });
  }
  if (!env.DB) return jsonResponse({ error: 'not_configured' }, { status: 503 });

  const now = nowSec();
  const SEVEN_DAYS_AGO = now - 7 * 24 * 3600;
  const ONE_DAY_AGO = now - 24 * 3600;

  // Все DELETE'ы — параллельно, независимы.
  const [rt, otp, ownerOtp, rl, expiredSessions] = await Promise.all([
    env.DB.prepare(
      'DELETE FROM realtime_events WHERE created_at < ?'
    ).bind(SEVEN_DAYS_AGO).run(),

    env.DB.prepare(
      'DELETE FROM otp_codes WHERE consumed = 1 AND created_at < ?'
    ).bind(ONE_DAY_AGO).run(),

    env.DB.prepare(
      'DELETE FROM owner_otp WHERE consumed = 1 AND created_at < ?'
    ).bind(ONE_DAY_AGO).run(),

    env.DB.prepare(
      'DELETE FROM rate_limits WHERE window_start < ?'
    ).bind(ONE_DAY_AGO).run(),

    // Истёкшие сессии — пользователи всё равно не залогинятся.
    env.DB.prepare(
      'DELETE FROM sessions WHERE expires_at < ?'
    ).bind(now).run()
  ]);

  return jsonResponse({
    ok: true,
    deleted: {
      realtime_events: rt.meta?.changes || 0,
      otp_codes: otp.meta?.changes || 0,
      owner_otp: ownerOtp.meta?.changes || 0,
      rate_limits: rl.meta?.changes || 0,
      sessions: expiredSessions.meta?.changes || 0
    }
  });
}
