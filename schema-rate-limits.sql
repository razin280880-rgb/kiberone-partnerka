-- Скользящее окно rate-limit для публичных эндпоинтов.
-- Применить: wrangler d1 execute kiberone-partnerka --remote --file=schema-rate-limits.sql

CREATE TABLE IF NOT EXISTS rate_limits (
  rl_key TEXT PRIMARY KEY,           -- 'scan:1.2.3.4' / 'submit:stomat_chln_01:1.2.3.4'
  window_start INTEGER NOT NULL,     -- unix-секунды начала окна
  count INTEGER NOT NULL DEFAULT 1
);

-- Хранение IP сканов — пригодится для антифрод-аналитики и timing-check.
-- В scans мы уже сохраняем scanned_at; здесь только добавим IP.
-- Если колонка уже есть — миграция бесшумно проигнорируется.
-- D1 не поддерживает ADD COLUMN IF NOT EXISTS, поэтому делаем через try/catch снаружи.
-- На пустой БД достаточно ALTER в одиночку.
ALTER TABLE scans ADD COLUMN ip TEXT;
