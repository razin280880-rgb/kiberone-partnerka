-- Owner-сессии (для админ-дашборда собственника).
-- Применить: wrangler d1 execute kiberone-partnerka --remote --file=schema-owner.sql

-- Добавляем role в sessions. Для партнёров — 'partner' (дефолт), для собственника — 'owner'.
-- partner_slug для owner-сессий = '__owner__' (placeholder, чтобы NOT NULL constraint не падал).
ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'partner';

-- OTP для входа собственника. Отдельная таблица — другой rate-limit, разные правила.
CREATE TABLE IF NOT EXISTS owner_otp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_otp_tg ON owner_otp(telegram_user_id, created_at);

-- Лог админ-действий — кто, когда, что сделал. Для аудита.
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_telegram_id INTEGER NOT NULL,
  action TEXT NOT NULL,                  -- dispute_accept / dispute_reject / lead_status_change / partner_pause / ...
  target_type TEXT,                       -- lead / dispute / partner
  target_id TEXT,
  payload_json TEXT,                      -- что именно поменяли
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_log_created ON admin_log(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_log_actor ON admin_log(actor_telegram_id);
