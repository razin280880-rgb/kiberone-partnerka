// POST /api/cron/mr-digest
// Триггер: GitHub Actions каждый ПН 09:30 МСК (06:30 UTC) — раньше партнёрской сводки,
// чтобы МР зашли в кабинет до того, как партнёры зададут вопросы.
//
// Что делает:
//  Группирует партнёров по mr_telegram и шлёт каждому МР сводку по его «портфелю»:
//    - сколько партнёров активно
//    - сколько без анкет ≥7 дней (просадка)
//    - сколько без анкет ≥14 дней (риск)
//    - топ-3 по неделе
//    - суммарно лидов / пробных / оплат за неделю
//
// Защита: X-Cron-Secret = env.CRON_SECRET.

import { jsonResponse, nowSec } from '../../_lib/auth.js';

const fmt = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0));

async function sendTelegram(env, chat_id, text) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  return r.ok;
}

async function buildPortfolio(env, mr_telegram, weekStart, twoWeeksStart) {
  // Партнёры этого МР.
  const { results: partners } = await env.DB.prepare(
    `SELECT slug, name, city
       FROM partners
      WHERE mr_telegram = ? AND status = 'active'`
  ).bind(mr_telegram).all();

  if (!partners || partners.length === 0) {
    return null;
  }

  // Метрики по каждому партнёру за неделю.
  const enriched = [];
  for (const p of partners) {
    const lastSubmit = await env.DB.prepare(
      'SELECT MAX(submitted_at) AS last FROM leads WHERE partner_slug = ?'
    ).bind(p.slug).first();
    const week = await env.DB.prepare(
      `SELECT COUNT(*) AS leads,
              SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
              SUM(CASE WHEN status IN ('trial_came','paid') THEN 1 ELSE 0 END) AS trials,
              COALESCE(SUM(reward_anketa+COALESCE(reward_trial,0)+COALESCE(reward_paid,0)),0) AS amount
         FROM leads WHERE partner_slug = ? AND submitted_at >= ?`
    ).bind(p.slug, weekStart).first();

    enriched.push({
      ...p,
      leads: week?.leads || 0,
      trials: week?.trials || 0,
      paid: week?.paid || 0,
      amount: week?.amount || 0,
      lastSubmit: lastSubmit?.last || 0
    });
  }

  const now = nowSec();
  const drowsy = enriched.filter(p => p.lastSubmit && now - p.lastSubmit > 7 * 24 * 3600 && now - p.lastSubmit <= 14 * 24 * 3600);
  const cold = enriched.filter(p => !p.lastSubmit || now - p.lastSubmit > 14 * 24 * 3600);
  const top3 = [...enriched].sort((a, b) => b.leads - a.leads).slice(0, 3).filter(p => p.leads > 0);

  const total = enriched.reduce((acc, p) => ({
    leads: acc.leads + p.leads,
    trials: acc.trials + p.trials,
    paid: acc.paid + p.paid,
    amount: acc.amount + p.amount
  }), { leads: 0, trials: 0, paid: 0, amount: 0 });

  return { partners: enriched, drowsy, cold, top3, total };
}

function formatDigest(portfolio) {
  const { partners, drowsy, cold, top3, total } = portfolio;

  const lines = [];
  lines.push(`<b>🗂 Дайджест МР за прошедшую неделю</b>\n`);
  lines.push(`Партнёров активно: <b>${partners.length}</b>`);
  lines.push(`Суммарно: <b>${total.leads}</b> анкет / <b>${total.trials}</b> пробных / <b>${total.paid}</b> оплат`);
  lines.push(`Партнёрам начислено: <b>${fmt(total.amount)} ₽</b>\n`);

  if (top3.length) {
    lines.push(`<b>🔥 Топ-3 недели</b>`);
    top3.forEach((p, i) => {
      lines.push(`${['🥇','🥈','🥉'][i]} ${p.name} — ${p.leads} анкет`);
    });
    lines.push('');
  }

  if (drowsy.length) {
    lines.push(`<b>⚠️ Просадка (без анкет 7–14 дней)</b>`);
    drowsy.forEach(p => {
      const days = Math.floor((nowSec() - p.lastSubmit) / 86400);
      lines.push(`• ${p.name} (${p.city}) — ${days} дн.`);
    });
    lines.push('→ Позвонить, проверить, не закончились ли призы.\n');
  }

  if (cold.length) {
    lines.push(`<b>🚨 Риск отвала (≥14 дней без анкет)</b>`);
    cold.forEach(p => {
      const days = p.lastSubmit ? Math.floor((nowSec() - p.lastSubmit) / 86400) : '—';
      lines.push(`• ${p.name} (${p.city}) — ${days} дн.`);
    });
    lines.push('→ Личный визит на этой неделе.\n');
  }

  if (!drowsy.length && !cold.length && partners.length) {
    lines.push(`✅ Все партнёры активны. Отличная работа!\n`);
  }

  lines.push('Подробнее → https://partner.it-kiber.ru/cabinet.html');
  return lines.join('\n');
}

export async function onRequestPost({ request, env }) {
  const secret = request.headers.get('X-Cron-Secret');
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return jsonResponse({ error: 'forbidden' }, { status: 403 });
  }
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN) {
    return jsonResponse({ error: 'not_configured' }, { status: 503 });
  }

  // Берём всех уникальных МР с заполненным mr_telegram.
  const { results: mrs } = await env.DB.prepare(
    `SELECT mr_telegram, mr_name
       FROM partners
      WHERE mr_telegram IS NOT NULL AND mr_telegram != '' AND status = 'active'
   GROUP BY mr_telegram`
  ).all();

  const now = nowSec();
  const weekStart = now - 7 * 24 * 3600;
  const twoWeeksStart = now - 14 * 24 * 3600;

  let sent = 0;
  let errors = 0;

  for (const mr of mrs || []) {
    try {
      const portfolio = await buildPortfolio(env, mr.mr_telegram, weekStart, twoWeeksStart);
      if (!portfolio) continue;
      const ok = await sendTelegram(env, mr.mr_telegram, formatDigest(portfolio));
      if (ok) sent++; else errors++;
    } catch (e) {
      console.error('mr digest error', mr.mr_telegram, e);
      errors++;
    }
  }

  return jsonResponse({ ok: true, sent, errors, total: (mrs || []).length });
}
