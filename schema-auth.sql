-- Дополнение к schema.sql — таблицы для аутентификации партнёров.
-- Применить: wrangler d1 execute kiberone-partnerka --remote --file=schema-auth.sql

-- Telegram-привязки: партнёр пишет /start <slug> боту → telegram_user_id связывается со slug.
-- Один партнёр = один Telegram-аккаунт. При смене — старая связь перезаписывается.
CREATE TABLE IF NOT EXISTS telegram_bindings (
  partner_slug TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  telegram_username TEXT,
  bound_at INTEGER NOT NULL,
  FOREIGN KEY (partner_slug) REFERENCES partners(slug)
);
CREATE INDEX IF NOT EXISTS idx_tg_bindings_user ON telegram_bindings(telegram_user_id);

-- Одноразовые коды для входа в кабинет. Живут 10 минут.
-- Поток: партнёр на /login вводит slug → /api/auth/request-code → код приходит ему в Telegram
-- → партнёр вводит 6 цифр → /api/auth/verify создаёт сессию.
CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_slug TEXT NOT NULL,
  code TEXT NOT NULL,                  -- 6 цифр
  attempts INTEGER NOT NULL DEFAULT 0, -- неправильных попыток (max 5)
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (partner_slug) REFERENCES partners(slug)
);
CREATE INDEX IF NOT EXISTS idx_otp_partner ON otp_codes(partner_slug, created_at);
CREATE INDEX IF NOT EXISTS idx_otp_code ON otp_codes(code, partner_slug, consumed);

-- Сессии партнёров. JWT не используем — храним токены в БД,
-- так проще ревокация и rate-limit. Cookie HttpOnly + Secure + SameSite=Strict.
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  partner_slug TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip_first TEXT,
  ua_first TEXT,
  FOREIGN KEY (partner_slug) REFERENCES partners(slug)
);
CREATE INDEX IF NOT EXISTS idx_sessions_partner ON sessions(partner_slug, expires_at);

-- Rate-limit отправки OTP по партнёру (не больше 3 кодов за 10 минут).
CREATE TABLE IF NOT EXISTS otp_throttle (
  partner_slug TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1
);
