-- KIBERone Партнёрка — D1 schema
-- Создание: wrangler d1 create kiberone-partnerka
-- Миграция:  wrangler d1 execute kiberone-partnerka --file=schema.sql

-- Партнёры
CREATE TABLE IF NOT EXISTS partners (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                  -- stomat / eng / chess / art / danc / cafe / sport
  city TEXT NOT NULL,                  -- chln / nkmsk / kzn / elb / krd / srg / prm
  legal_entity TEXT NOT NULL,          -- ip_razin / ip_karina / ooo_lab
  rate_anketa INTEGER NOT NULL,        -- ставка за анкету
  status TEXT NOT NULL DEFAULT 'active',
  tier TEXT NOT NULL DEFAULT 'base',   -- base / silver / gold / year
  telegram_id INTEGER,
  contact_email TEXT,
  contact_phone TEXT,
  requisites_json TEXT,                -- JSON с реквизитами для выплат
  mr_name TEXT,
  mr_telegram TEXT,
  mr_whatsapp TEXT,
  created_at INTEGER NOT NULL
);

-- Сканы QR
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_slug TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_agent TEXT,
  city_geo TEXT,
  scanned_at INTEGER NOT NULL,
  FOREIGN KEY (partner_slug) REFERENCES partners(slug)
);

CREATE INDEX IF NOT EXISTS idx_scans_partner ON scans(partner_slug, scanned_at);
CREATE INDEX IF NOT EXISTS idx_scans_session ON scans(session_id);

-- Лиды (анкеты)
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_slug TEXT NOT NULL,
  session_id TEXT NOT NULL,
  child_name TEXT NOT NULL,
  child_age INTEGER NOT NULL,
  parent_whatsapp TEXT NOT NULL,
  city TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',  -- new / qualified / trial_booked / trial_came / paid / rejected
  alphacrm_lead_id INTEGER,
  reward_anketa INTEGER DEFAULT 0,
  reward_trial INTEGER DEFAULT 0,
  reward_paid INTEGER DEFAULT 0,
  ml_score REAL,
  submitted_at INTEGER NOT NULL,
  status_changed_at INTEGER,
  dispute_reason TEXT,
  FOREIGN KEY (partner_slug) REFERENCES partners(slug)
);

CREATE INDEX IF NOT EXISTS idx_leads_partner ON leads(partner_slug, submitted_at);
CREATE INDEX IF NOT EXISTS idx_leads_session ON leads(session_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status, submitted_at);

-- Выплаты
CREATE TABLE IF NOT EXISTS payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_slug TEXT NOT NULL,
  period TEXT NOT NULL,                -- YYYY-MM
  total_amount INTEGER NOT NULL,
  leads_count INTEGER NOT NULL,
  trials_count INTEGER NOT NULL,
  paid_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending / paid / disputed
  act_url TEXT,
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (partner_slug) REFERENCES partners(slug)
);

CREATE INDEX IF NOT EXISTS idx_payouts_partner_period ON payouts(partner_slug, period);

-- Демо-партнёр для разработки
INSERT OR IGNORE INTO partners (slug, name, type, city, legal_entity, rate_anketa, mr_name, created_at)
VALUES ('demo_chln_01', 'Детская стоматология «Зубарик»', 'stomat', 'chln', 'ip_razin', 200, 'Анна', strftime('%s','now'));
