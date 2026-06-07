// POST /api/scan — фиксация скана QR
// Body: { partner_slug, session_id, ua }

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { partner_slug, session_id, ua } = body;

    if (!partner_slug || !session_id) {
      return new Response('Bad Request', { status: 400 });
    }

    // Сохранение в D1 (если биндинг настроен)
    if (env.DB) {
      await env.DB.prepare(
        'INSERT INTO scans (partner_slug, session_id, user_agent, scanned_at) VALUES (?, ?, ?, ?)'
      ).bind(partner_slug, session_id, ua || '', Math.floor(Date.now() / 1000)).run();
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
