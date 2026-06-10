// POST /api/admin/disputes/resolve
// Body: { lead_id, action: 'accept' | 'reject', note? }
//
// 'accept' — спор партнёра принят: статус становится 'rejected',
//   начисления обнуляются (партнёр не получит оплату за эту анкету).
// 'reject' — спор отклонён: dispute_reason очищается, статус не меняем,
//   начисление остаётся как было.
//
// В обоих случаях: log в admin_log, Telegram-уведомление партнёру.

import { jsonResponse, readSession, nowSec, logAdminAction } from '../../../_lib/auth.js';

async function notifyPartner(env, lead, action, note) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.DB) return;
  const binding = await env.DB.prepare(
    'SELECT telegram_user_id FROM telegram_bindings WHERE partner_slug = ?'
  ).bind(lead.partner_slug).first();
  if (!binding?.telegram_user_id) return;

  const text = action === 'accept'
    ? `✅ <b>Ваш спор по анкете #${lead.id} принят.</b>\n\nНачисление аннулировано. ` +
      `Если хотите уточнить детали — напишите менеджеру.` +
      (note ? `\n\n<b>Комментарий:</b> ${note}` : '')
    : `❌ <b>Ваш спор по анкете #${lead.id} отклонён.</b>\n\nНачисление остаётся в силе.` +
      (note ? `\n\n<b>Комментарий:</b> ${note}` : '');

  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: binding.telegram_user_id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
  } catch (e) { console.error('notify partner error', e); }
}

export async function onRequestPost({ request, env }) {
  const session = await readSession(env, request);
  if (!session) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  if (session.role !== 'owner') return jsonResponse({ error: 'forbidden' }, { status: 403 });
  if (!env.DB) return jsonResponse({ error: 'd1_unavailable' }, { status: 503 });

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'bad_json' }, { status: 400 }); }

  const lead_id = parseInt(body.lead_id, 10);
  const action = body.action;
  const note = (body.note || '').trim().slice(0, 500);

  if (!lead_id || !['accept', 'reject'].includes(action)) {
    return jsonResponse({ error: 'bad_input' }, { status: 400 });
  }

  const lead = await env.DB.prepare(
    'SELECT id, partner_slug, status, dispute_reason FROM leads WHERE id = ?'
  ).bind(lead_id).first();

  if (!lead) return jsonResponse({ error: 'not_found' }, { status: 404 });
  if (!lead.dispute_reason) {
    return jsonResponse({ error: 'no_active_dispute' }, { status: 400 });
  }

  if (action === 'accept') {
    // Спор принят — анкета признана невалидной.
    await env.DB.prepare(
      `UPDATE leads SET status = 'rejected',
              reward_anketa = 0, reward_trial = 0, reward_paid = 0,
              dispute_reason = NULL,
              status_changed_at = ?
        WHERE id = ?`
    ).bind(nowSec(), lead_id).run();
  } else {
    // Спор отклонён — оставляем статус и начисления как есть, только убираем флаг.
    await env.DB.prepare(
      'UPDATE leads SET dispute_reason = NULL, status_changed_at = ? WHERE id = ?'
    ).bind(nowSec(), lead_id).run();
  }

  // session не содержит telegram_id напрямую (sessions хранят только partner_slug+role).
  // Можно был бы добавить — пока пишем 0 в actor, см. TODO. Для аудита достаточно
  // факта решения; кто именно — owner один (или несколько whitelisted).
  await logAdminAction(env, 0, `dispute_${action}`, 'lead', lead_id, { note });

  await notifyPartner(env, lead, action, note);

  return jsonResponse({ ok: true, action, lead_id });
}
