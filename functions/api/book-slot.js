// POST /api/book-slot — бронирование слота пробного
// Body: { session_id, partner_slug, slot_iso }
// Делает: ищет лид по session_id, обновляет статус → trial_booked, шлёт второе сообщение в WhatsApp

async function findLeadBySession(env, session_id) {
  if (!env.DB) return null;
  return env.DB.prepare('SELECT * FROM leads WHERE session_id = ? LIMIT 1').bind(session_id).first();
}

async function updateLeadStatus(env, leadId, status) {
  if (!env.DB) return;
  await env.DB.prepare(
    'UPDATE leads SET status = ?, status_changed_at = ? WHERE id = ?'
  ).bind(status, Math.floor(Date.now() / 1000), leadId).run();
}

async function notifyWhatsApp(env, lead, slot_iso) {
  if (!env.WAZZUP_API_KEY || !lead) return;
  const slotDate = new Date(slot_iso);
  const dt = slotDate.toLocaleString('ru-RU', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
  });
  const text =
    `✅ Бронь подтверждена!\n\n` +
    `Пробный урок для ${lead.child_name}: ${dt}\n\n` +
    `Адрес уточним за день до урока. Возьмите с собой жетон из куба — получите приз 2× ценнее 🎁`;
  try {
    await fetch('https://api.wazzup24.com/v3/message', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.WAZZUP_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channelId: env.WAZZUP_CHANNEL_ID,
        chatId: lead.parent_whatsapp + '@c.us',
        chatType: 'whatsapp',
        text
      })
    });
  } catch (e) { /* swallow */ }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { session_id, partner_slug, slot_iso } = body;
    if (!session_id || !slot_iso) {
      return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
    }

    const lead = await findLeadBySession(env, session_id);
    if (lead) {
      await updateLeadStatus(env, lead.id, 'trial_booked');
      await notifyWhatsApp(env, lead, slot_iso);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
