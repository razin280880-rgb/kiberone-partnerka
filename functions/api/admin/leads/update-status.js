// POST /api/admin/leads/update-status
// Body: { lead_id, status: 'qualified'|'trial_booked'|'trial_came'|'paid'|'rejected', note? }
//
// Ручная корректировка статуса собственником. При повышении статуса начисляются
// дополнительные суммы (trial → +500, paid → +2000). При rejected — обнуляются.

import { jsonResponse, readSession, nowSec, logAdminAction } from '../../../_lib/auth.js';
import { emitEvent } from '../../../_lib/realtime.js';

const ALLOWED = ['qualified', 'trial_booked', 'trial_came', 'paid', 'rejected'];

async function notifyPartner(env, lead, newStatus) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.DB) return;
  const binding = await env.DB.prepare(
    `SELECT b.telegram_user_id, p.name FROM telegram_bindings b
       JOIN partners p ON p.slug = b.partner_slug
      WHERE b.partner_slug = ?`
  ).bind(lead.partner_slug).first();
  if (!binding?.telegram_user_id) return;

  const messages = {
    qualified: '✅ Анкета #{ID} квалифицирована — начислено {AMT} ₽.',
    trial_booked: '📅 Лид #{ID} записан на пробный.',
    trial_came: '🎯 Лид #{ID} пришёл на пробный — начислено +500 ₽.',
    paid: '💰 Лид #{ID} оплатил годовой — начислено +2000 ₽!',
    rejected: '⚠️ Анкета #{ID} отклонена. Начисление аннулировано.'
  };
  const text = messages[newStatus].replace('{ID}', lead.id).replace('{AMT}', lead.reward_anketa || 200);

  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: binding.telegram_user_id,
        text,
        parse_mode: 'HTML'
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
  const status = body.status;
  const note = (body.note || '').trim().slice(0, 500);

  if (!lead_id || !ALLOWED.includes(status)) {
    return jsonResponse({ error: 'bad_input' }, { status: 400 });
  }

  const lead = await env.DB.prepare(
    `SELECT id, partner_slug, status, reward_anketa, p.rate_anketa
       FROM leads
       JOIN partners p ON p.slug = leads.partner_slug
      WHERE leads.id = ?`
  ).bind(lead_id).first();

  if (!lead) return jsonResponse({ error: 'not_found' }, { status: 404 });

  // Логика начислений.
  const now = nowSec();
  if (status === 'rejected') {
    await env.DB.prepare(
      `UPDATE leads SET status = 'rejected',
              reward_anketa = 0, reward_trial = 0, reward_paid = 0,
              status_changed_at = ?
        WHERE id = ?`
    ).bind(now, lead_id).run();
  } else if (status === 'qualified') {
    await env.DB.prepare(
      `UPDATE leads SET status = 'qualified',
              reward_anketa = ?,
              status_changed_at = ?
        WHERE id = ?`
    ).bind(lead.rate_anketa || 200, now, lead_id).run();
  } else if (status === 'trial_booked') {
    await env.DB.prepare(
      "UPDATE leads SET status = 'trial_booked', status_changed_at = ? WHERE id = ?"
    ).bind(now, lead_id).run();
  } else if (status === 'trial_came') {
    await env.DB.prepare(
      `UPDATE leads SET status = 'trial_came',
              reward_trial = 500,
              status_changed_at = ?
        WHERE id = ?`
    ).bind(now, lead_id).run();
  } else if (status === 'paid') {
    await env.DB.prepare(
      `UPDATE leads SET status = 'paid',
              reward_trial = COALESCE(NULLIF(reward_trial, 0), 500),
              reward_paid = 2000,
              status_changed_at = ?
        WHERE id = ?`
    ).bind(now, lead_id).run();
  }

  await logAdminAction(env, 0, 'lead_status_change', 'lead', lead_id, {
    from: lead.status, to: status, note
  });
  await notifyPartner(env, lead, status);

  // Realtime: партнёр получает событие — кабинет переотрисовывает анкеты,
  // owner-дашборд обновляет KPI.
  await emitEvent(env, `partner:${lead.partner_slug}`, 'status_changed', {
    lead_id, from: lead.status, to: status
  });
  await emitEvent(env, 'owner', 'status_changed', { lead_id, to: status });

  return jsonResponse({ ok: true, lead_id, status });
}
