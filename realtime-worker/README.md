# kiberone-realtime

Standalone Cloudflare Worker для WebSocket-канала партнёрского кабинета.

## Архитектура

```
              ┌───────────────────────┐
   Browser ───┤ Pages /api/realtime/  │  GET ws-token →  HMAC(audience,exp)
              │ ws-token              │
              └──────────┬────────────┘
                         │
   Browser ──────WS──────► wss://realtime-partner.it-kiber.ru/ws?token=…
                                  │
                                  ▼
                       ┌──────────────────┐
                       │ kiberone-realtime│
                       │  (this Worker)   │
                       │                  │
                       │  validateToken() │
                       │  HUB.idFromName  │
                       │       (audience) │
                       │       │          │
                       │       ▼          │
                       │  RealtimeHub DO  │
                       │  (per audience)  │
                       │   .acceptWebSocket
                       │   .broadcast(ev) │
                       └──────────────────┘
                              ▲
                              │ POST /broadcast (X-Internal-Secret)
                              │
                       ┌──────┴───────────┐
                       │ Pages emitEvent  │
                       │ (submit, dispute │
                       │  resolve, etc.)  │
                       └──────────────────┘
```

## Endpoints

- `GET /health` — liveness check.
- `GET /ws?token=<HMAC>` — WebSocket upgrade. Токен валидируется через `REALTIME_SHARED_SECRET`.
- `POST /broadcast` (защищено `X-Internal-Secret`) — Pages эмитит сюда события.
  Тело: `{ audience: "partner:slug" | "owner", event: {type, payload, ts} }`

## Durable Object: RealtimeHub

Один экземпляр на каждую audience (`HUB.idFromName(audience)`).
- Использует **Hibernation API** (`state.acceptWebSocket`) — инстанс может спать,
  Cloudflare пробуждает при сообщениях или broadcast'е.
- `webSocketMessage` — отвечает `pong` на `{type: 'ping'}` для heartbeat'ов.
- `webSocketClose` / `webSocketError` — Cloudflare сам убирает WS из state.

## Env (production)

| Variable | Value |
|---|---|
| `REALTIME_SHARED_SECRET` | случайные 32–64 байта; должен совпадать с тем, что в Pages |

## Деплой

Авто-деплой через `.github/workflows/deploy-realtime-worker.yml` при push в `realtime-worker/`.

Первичная настройка:
```bash
# 1. Получить ID DO storage (на первом деплое создастся)
npx wrangler deploy

# 2. Назначить кастомный домен (через UI или wrangler):
#    realtime-partner.it-kiber.ru → этот Worker
#    Cloudflare → Worker → Settings → Domains & Routes → Add Custom Domain

# 3. Положить REALTIME_SHARED_SECRET:
npx wrangler secret put REALTIME_SHARED_SECRET
```

## Локальный dev

```bash
npm run dev   # wrangler dev
```

Локально WS будет доступен на `ws://localhost:8787/ws?token=…`. Токен можно сгенерить руками или взять из локального запуска Pages.

## Тесты

```bash
npm test
```

Покрыты:
- HMAC sign/verify (туда-обратно, чужой секрет, expired, tampered, сложные audience).

## Стоимость (ориентир 2026)

- Standard DO + WebSocket Hibernation:
  - $0.65 / 1 млн **активных** GB·s (только пока обрабатывает сообщение).
  - При hibernation простой WS почти бесплатен.
- Один партнёр в кабинете 1 час → ≈0.001 GB·s ≈ <0.1 коп/час.
- 100 одновременных партнёров × 8 рабочих часов ≈ <1 ₽/день.
