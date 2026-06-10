// POST /api/cron/weekly-summary
// Триггерится GitHub Actions каждый ПН 10:00 МСК.
// Защита: заголовок X-Cron-Secret должен совпадать с env.CRON_SECRET.
//
// Что делает:
//  1. Берёт всех активных партнёров с привязанным Telegram.
//  2. Считает сводку за последние 7 дней.
//  3. Шлёт в Telegram форматированное сообщение.
//  4. Возвращает счётчик отправленных сообщений.

import { jsonResponse, nowSec } from '../../_lib/auth.js';

const fmt = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0));

function summaryText(partner, weekStats, prevStats) {
  const now = new Date();
  const sevenAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const period = `${sevenAgo.getDate()}.${String(sevenAgo.getMonth() + 1).padStart(2, '0')} – ${now.getDate()}.${String(now.getMonth() + 1).padStart(2, '0')}`;

  const diff = (cur, prev) => {
    if (!prev) return '';
    const d = cur - prev;
    if (d === 0) return ' (без изменений)';
    return d > 0 ? ` (▲ ${d})` : ` (▼ ${-d})`;
  };

  let coachTip = '';
  if (weekStats.leads === 0) {
    coachTip = `\n\n💡 За неделю ноль анкет. Возможные причины:\n` +
      `• Куб не на видном месте — переставьте у ресепшена.\n` +
      `• Администратор не предлагает приз — повторите видео-инструкцию.\n` +
      `• Кончились призы — напишите боту: «Кончились призы».`;
  } else if (weekStats.leads < 5) {
    coachTip = `\n\n💡 Целевая норма — 5 анкет/неделю. Идём чуть ниже. ` +
      `Поговорите с администратором: 1 раз озвучить приз = 1 ребёнок попробует.`;
  } else if (weekStats.leads >= 10) {
    coachTip = `\n\n🔥 Отличная неделя! Если такой темп продержится 3 месяца — ` +
      `автоматический переход на Серебряный уровень (+20 ₽ к ставке за анкету).`;
  }

  return (
    `<b>📊 Ваша сводка за ${period}</b>\n` +
    `${partner.name}\n\n` +
    `Сканов QR: <b>${weekStats.scans}</b>${diff(weekStats.scans, prevStats.scans)}\n` +
    `Анкет квалифицировано: <b>${weekStats.leads}</b>${diff(weekStats.leads, prevStats.leads)}\n` +
    `Пробных состоялось: <b>${weekStats.trials}</b>${diff(weekStats.trials, prevStats.trials)}\n` +
    `Оплат годовых: <b>${weekStats.paid}</b>${diff(weekStats.paid, prevStats.paid)}\n\n` +
    `Начислено за неделю: <b>${fmt(weekStats.amount)} ₽</b>\n` +
    coachTip +
    `\n\nПодробнее → https://partner.it-kiber.ru/cabinet.html`
  );
}

async function statsForRange(env, partner_slug, from, to) {
  const leadsRow = await env.DB.prepare(
    `SELECT COUNT(*) AS leads,
            SUM(CASE WHEN status IN ('trial_came','paid') THEN 1 ELSE 0 END) AS trials,
            SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
            COALESCE(SUM(reward_anketa+COALESCE(reward_trial,0)+COALESCE(reward_paid,0)),0) AS amount
       FROM leads WHERE partner_slug = ? AND submitted_at >= ? AND submitted_at < ?`
  ).bind(partner_slug, from, to).first();
  const scans = await env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM scans WHERE partner_slug = ? AND scanned_at >= ? AND scanned_at < ?'
  ).bind(partner_slug, from, to).first();
  return {
    leads: leadsRow?.leads || 0,
    trials: leadsRow?.trials || 0,
    paid: leadsRow?.paid || 0,
    amount: leadsRow?.amount || 0,
    scans: scans?.cnt || 0
  };
}

async function sendTelegram(env, chat_id, text) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  return r.ok;
}

export async function onRequestPost({ request, env }) {
  const secret = request.headers.get('X-Cron-Secret');
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    return jsonResponse({ error: 'forbidden' }, { status: 403 });
  }
  if (!env.DB || !env.TELEGRAM_BOT_TOKEN) {
    return jsonResponse({ error: 'not_configured' }, { status: 503 });
  }

  const now = nowSec();
  const weekStart = now - 7 * 24 * 3600;
  const prevWeekStart = now - 14 * 24 * 3600;

  // Берём всех активных партнёров с привязанным Telegram.
  const { results: partners } = await env.DB.prepare(
    `SELECT p.slug, p.name, p.city, b.telegram_user_id
       FROM partners p
       JOIN telegram_bindings b ON b.partner_slug = p.slug
      WHERE p.status = 'active'`
  ).all();

  let sent = 0;
  let errors = 0;
  for (const p of partners || []) {
    try {
      const weekStats = await statsForRange(env, p.slug, weekStart, now);
      const prevStats = await statsForRange(env, p.slug, prevWeekStart, weekStart);
      const ok = await sendTelegram(
        env,
        p.telegram_user_id,
        summaryText(p, weekStats, prevStats)
      );
      if (ok) sent++; else errors++;
    } catch (e) {
      console.error('summary error', p.slug, e);
      errors++;
    }
  }

  return jsonResponse({ ok: true, sent, errors, total: (partners || []).length });
}
