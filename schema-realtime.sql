-- Realtime: events table для push-уведомлений в кабинет.
-- Применить: wrangler d1 execute kiberone-partnerka --remote --file=schema-realtime.sql
--
-- Архитектура: server-side handlers пишут событие → клиент поллит /api/realtime/events?since=ts
-- → видит новые события за <5 сек. Без Durable Objects и отдельного Worker'а под DO.
--
-- audience определяет, кто увидит событие:
--   'partner:<slug>' — только конкретный партнёр (новый лид, статус обновлён)
--   'owner'          — все владельцы (диспут открылся, требует решения)
--   'mr:<telegram>'  — конкретный МР (партнёр в просадке)

CREATE TABLE IF NOT EXISTS realtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audience TEXT NOT NULL,                 -- 'partner:slug' / 'owner' / 'mr:tg_id'
  event_type TEXT NOT NULL,               -- new_lead / status_changed / dispute_opened / dispute_resolved
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_realtime_aud ON realtime_events(audience, created_at);
CREATE INDEX IF NOT EXISTS idx_realtime_ts ON realtime_events(created_at);

-- Очистка старых событий: храним только 7 дней (cron-задача чистит).
-- Достаточно для recovery после переподключения.
