// GET /api/config — публичные настройки, которые нужны фронту.
// Сейчас отдаёт только TURNSTILE_SITE_KEY (он публичный по дизайну Turnstile).
// Кэшируем на 5 мин — частые запросы не нужны, конфиг меняется редко.

export async function onRequestGet({ env }) {
  return new Response(
    JSON.stringify({
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || null
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      }
    }
  );
}
