# KIBERone — Партнёрская воронка (QR-страница + кабинет)

Воронка партнёрского канала лидгена KIBERone. QR на партнёрском Кубе → мини-игра «Конструктор кибергероя» → форма (имя ребёнка, возраст, WhatsApp родителя) → мгновенная награда (PDF-роадмап, видео-приветствие тьютора, электронный пригласительный, слот пробного) → Wazzup-автоответ → AI-звонок горячим лидам.

Связано: [120-partnerka-metodichka](../kiberone-management/120-partnerka-metodichka.md), [126-partnerka-kabinet](../kiberone-management/126-partnerka-kabinet.md).

---

## Стек

- **Frontend:** чистый HTML5 + CSS + vanilla JS, без сборки (стиль `kiber-summer-landing`)
- **Backend:** Cloudflare Pages Functions (`/functions/api/*`)
- **Хранение:** Cloudflare D1 (SQLite) — партнёры, UTM, анкеты, выплаты
- **Интеграции:** AlphaCRM API (лиды и пробные), Wazzup24 (WhatsApp), Telegram Bot API (аутентификация партнёра + сводки), ElevenLabs (по желанию — персональное аудио по имени ребёнка)
- **Хостинг:** Cloudflare Pages, автодеплой из GitHub при push в `main`
- **Домены:**
  - `partner.it-kiber.ru` → партнёрский кабинет
  - `kiber.gift/{slug}` → точка входа по QR с UTM-меткой

---

## Структура

```
kiberone-partnerka/
├── README.md
├── index.html                  # QR-страница: мини-игра + форма + награда
├── cabinet.html                # партнёрский кабинет: дашборд, анкеты, выплаты
├── _routes.json                # роутинг Cloudflare Pages (/api/* в Functions, остальное — статика)
├── assets/
│   ├── css/
│   │   ├── main.css            # общие стили (бренд KIBERone)
│   │   ├── landing.css         # стили QR-страницы
│   │   └── cabinet.css         # стили кабинета
│   ├── js/
│   │   ├── landing.js          # сценарий QR-страницы
│   │   ├── game.js             # конструктор кибергероя
│   │   ├── reward.js           # отрисовка экрана награды
│   │   └── cabinet.js          # дашборд кабинета
│   └── images/                 # SVG + иконки кибергероев
├── functions/
│   └── api/
│       ├── scan.js             # POST: фиксация скана QR (для аналитики)
│       ├── submit.js           # POST: отправка формы → AlphaCRM + Wazzup
│       ├── reward.js           # GET: персональная награда по сессии
│       ├── stats.js            # GET: метрики партнёра для кабинета
│       └── auth.js             # POST: вход партнёра через Telegram-OTP
├── roadmaps/                   # 3 готовых PDF-роадмапа по возрастам (заглушки)
│   ├── mladshaya-5-7.pdf
│   ├── srednyaya-8-11.pdf
│   └── starshaya-12-14.pdf
└── videos/                     # ТЗ + 21 текстовый сценарий
    ├── README.md
    ├── chln-mladshaya.md       # Челны, 5-7 лет
    ├── chln-srednyaya.md       # Челны, 8-11 лет
    ├── chln-starshaya.md       # Челны, 12-14 лет
    └── ... (всего 21 файл)
```

---

## Воронка QR-страницы

1. **Сканирование QR** → редирект на `kiber.gift/{slug}` (UTM партнёра)
2. **POST /api/scan** — счётчик сканов, привязка UTM к сессии
3. **Мини-игра «Конструктор кибергероя»** — 30-60 сек, IKEA-эффект
4. **Микро-коммитмент** — кнопка «Да, хочу узнать программу для моего ребёнка»
5. **Форма** — имя ребёнка, возраст, WhatsApp родителя
6. **POST /api/submit** — лид в AlphaCRM, сообщение через Wazzup24, метка партнёра
7. **Экран награды:**
   - Сгенерированная картинка «вот ты как кибергерой» с именем
   - PDF-роадмап по возрасту (вьювер)
   - Видео тьютора (по городу + возрасту)
   - Электронный пригласительный
   - Слот пробного из AlphaCRM-календаря
   - Жетон-обязательство «приди на пробный → приз 2× ценнее»
8. **Live-счётчик города** + **таймер обратного отсчёта** «бонус активен 24:00:00»
9. **Через 5 мин** — AI-звонок горячим лидам (по ML-скорингу)

---

## Деплой

```bash
# Локальный просмотр
npx wrangler pages dev .

# Деплой
git push origin main
# Cloudflare Pages автоматически собирает и деплоит
```

### Переменные окружения (Cloudflare Pages → Settings → Environment variables)

| Переменная | Назначение |
|---|---|
| `ALPHACRM_API_KEY` | API-ключ AlphaCRM для записи лидов |
| `ALPHACRM_HOSTNAME` | `kiberonenabchln.s20.online` |
| `WAZZUP_API_KEY` | Wazzup24 для WhatsApp-автоответа |
| `WAZZUP_CHANNEL_ID` | Канал WhatsApp KIBERone в Wazzup |
| `TELEGRAM_BOT_TOKEN` | Бот KIBERone-Partner для аутентификации и сводок |
| `ELEVENLABS_API_KEY` | (опционально) персональное аудио по имени ребёнка |
| `D1_DATABASE` | биндинг D1 в `wrangler.toml` |

### D1 schema

```sql
-- партнёры
CREATE TABLE partners (
  slug TEXT PRIMARY KEY,
  name TEXT,
  type TEXT,
  city TEXT,
  legal_entity TEXT,     -- ip_razin / ip_karina / ooo_lab
  rate_anketa INTEGER,   -- ставка за анкету
  status TEXT,            -- active / paused / blocked
  telegram_id INTEGER,
  created_at INTEGER
);

-- сканы QR
CREATE TABLE scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_slug TEXT,
  session_id TEXT,
  user_agent TEXT,
  city_geo TEXT,
  scanned_at INTEGER
);

-- анкеты
CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_slug TEXT,
  session_id TEXT,
  child_name TEXT,
  child_age INTEGER,
  parent_whatsapp TEXT,
  city TEXT,
  status TEXT,           -- new / qualified / trial_booked / trial_came / paid / rejected
  alphacrm_lead_id INTEGER,
  reward_anketa INTEGER, -- сколько начислено партнёру
  reward_trial INTEGER,
  reward_paid INTEGER,
  ml_score REAL,         -- 0-1 вероятность оплаты
  submitted_at INTEGER,
  status_changed_at INTEGER
);

-- выплаты
CREATE TABLE payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_slug TEXT,
  period TEXT,           -- YYYY-MM
  total_amount INTEGER,
  status TEXT,           -- pending / paid / disputed
  paid_at INTEGER
);
```

---

## Метрики (для сводок)

Каждый понедельник в 10:00 МСК cron-задача в Cloudflare Workers:
- считает сводку по каждому партнёру за прошедшую неделю
- отправляет в Telegram через `TELEGRAM_BOT_TOKEN`

Каждое 1-е число месяца:
- закрывает отчётный период
- формирует акты (PDF)
- отправляет партнёрам уведомление о сверке

---

## Стиль (бренд)

Цвета KIBERone:
- Фиолетовый: `#6B2FB5`
- Жёлтый: `#FFD43B`
- Тёмно-серый: `#1A1A2E`
- Светло-серый: `#F5F5FA`

Шрифты: Inter (UI), Manrope (заголовки). Хостятся локально для скорости.

---

## Roadmap разработки

### MVP (2 недели) — для пилота в Челнах
- [ ] QR-страница: мини-игра + форма + статичная награда
- [ ] POST /api/submit → AlphaCRM + Wazzup
- [ ] Cabinet HTML с моками (для демо партнёрам)
- [ ] 3 видео-приветствия (Челны × 3 возраста) сняты
- [ ] 3 PDF-роадмапа на загрузке (mladshaya/srednyaya/starshaya)

### V2 (после пилота) — для раската на 6 городов
- [ ] Кабинет — реальные данные из D1 + AlphaCRM
- [ ] Telegram-аутентификация партнёров
- [ ] Еженедельные сводки в Telegram
- [ ] 21 видео-приветствие (по всем городам)
- [ ] ML-скоринг лидов

### V3 (зрелость)
- [ ] AI-генерация картинки «вот ты как кибергерой» с именем
- [ ] ElevenLabs персональное аудио по имени ребёнка
- [ ] A/B-тесты разных вариантов мини-игры и формы
- [ ] Программа лояльности (статусы партнёров)
- [ ] Реф-ссылки «партнёр привёл партнёра»
