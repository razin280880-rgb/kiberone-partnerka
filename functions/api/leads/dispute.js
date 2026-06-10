// POST /api/leads/dispute
// Body: { lead_id, reason }
//
// Партнёр оспаривает квалификацию анкеты. Запись остаётся, статус не меняем —
// добавляем dispute_reason; МР видит в Telegram + в админ-кабинете.
// Финальное решение принимает РОП.

import { jsonResponse, readSession, nowSec } from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const session = await readSession(env, request);
  if (!session) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  if (!env.DB) return jsonResponse({ error: 'd1_unavailable' }, { status: 503 });

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'bad_json' }, { status: 400 }); }

  const lead_id = parseInt(body.lead_id, 10);
  const reason = String(body.reason || '').trim().slice(0, 500);
  if (!lead_id || reason.length < 5) {
    return jsonResponse({ error: 'bad_input', message: 'Опишите причину (от 5 символов)' }, { status: 400 });
  }

  // Проверка владения: лид должен принадлежать этому партнёру.
  const lead = await env.DB.prepare(
    'SELECT id, partner_slug, child_age, status, submitted_at FROM leads WHERE id = ?'
  ).bind(lead_id).first();

  if (!lead) return jsonResponse({ error: 'not_found' }, { status: 404 });
  if (lead.partner_slug !== session.partner_slug) {
    return jsonResponse({ error: 'forbidden' }, { status: 403 });
  }

  await env.DB.prepare(
    'UPDATE leads SET dispute_reason = ?, status_changed_at = ? WHERE id = ?'
  ).bind(reason, nowSec(), lead_id).run();

  // Уведомление МР в Telegram (если у партнёра проставлен mr_telegram)
  const partner = await env.DB.prepare(
    'SELECT name, city, mr_name, mr_telegram FROM partners WHERE slug = ?'
  ).bind(session.partner_slug).first();

  if (env.TELEGRAM_BOT_TOKEN && partner && partner.mr_telegram) {
    const dateStr = new Date(lead.submitted_at * 1000).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    const text =
      `⚖️ <b>Партнёр оспорил анкету</b>\n\n` +
      `Партнёр: ${partner.name} (${partner.city})\n` +
      `Лид #${lead_id} от ${dateStr}, возраст ${lead.child_age}\n` +
      `Текущий статус: ${lead.status}\n\n` +
      `<b>Причина:</b> ${reason}\n\n` +
      `Откройте в админ-кабинете для решения.`;
    try {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: partner.mr_telegram,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });
    } catch (e) { console.error('mr notify error', e); }
  }

  return jsonResponse({ ok: true });
}
