// GET /api/stats?type=live&city=chln — общий live-счётчик города для лендинга (публично).
// GET /api/stats — статистика партнёра для кабинета (требует сессии). slug берётся из сессии.

import { jsonResponse, readSession, nowSec } from '../_lib/auth.js';

async function getLiveCount(env, city) {
  if (!env.DB) return { todayCount: 47 + Math.floor((Date.now() % 20000) / 1000) };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startTs = Math.floor(today.getTime() / 1000);
  const r = await env.DB.prepare(
    `SELECT COUNT(DISTINCT session_id) AS cnt FROM leads
     WHERE submitted_at >= ? AND partner_slug LIKE ?`
  ).bind(startTs, `%_${city}_%`).first();
  return { todayCount: r ? r.cnt : 0 };
}

async function getPartnerStats(env, slug) {
  if (!env.DB) return null;
  const now = nowSec();
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartTs = Math.floor(monthStart.getTime() / 1000);

  const leadsRow = await env.DB.prepare(
    `SELECT COUNT(*) AS leads_count,
            SUM(CASE WHEN status IN ('trial_came','paid') THEN 1 ELSE 0 END) AS trials,
            SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
            COALESCE(SUM(reward_anketa+COALESCE(reward_trial,0)+COALESCE(reward_paid,0)),0) AS amount
       FROM leads
      WHERE partner_slug = ? AND submitted_at >= ?`
  ).bind(slug, monthStartTs).first();

  const scans30 = await env.DB.prepare(
    `SELECT date(scanned_at, 'unixepoch') AS day, COUNT(*) AS cnt
       FROM scans
      WHERE partner_slug = ? AND scanned_at >= ?
   GROUP BY day ORDER BY day`
  ).bind(slug, now - 30 * 24 * 3600).all();

  const partner = await env.DB.prepare(
    `SELECT slug, name, city, tier, rate_anketa, requisites_json, mr_name, mr_telegram, mr_whatsapp
       FROM partners WHERE slug = ?`
  ).bind(slug).first();

  return {
    partner: partner ? {
      ...partner,
      requisites: partner.requisites_json ? JSON.parse(partner.requisites_json) : null
    } : null,
    stats: {
      monthAmount: leadsRow ? leadsRow.amount : 0,
      leadsCount: leadsRow ? leadsRow.leads_count : 0,
      trialsCount: leadsRow ? leadsRow.trials : 0,
      paidCount: leadsRow ? leadsRow.paid : 0,
      scans30d: (scans30.results || []).map(r => r.cnt)
    }
  };
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');

  // Публичный live-счётчик — без сессии.
  if (type === 'live') {
    const city = url.searchParams.get('city') || 'chln';
    const data = await getLiveCount(env, city);
    return jsonResponse(data);
  }

  // Партнёрские метрики — только по сессии.
  const session = await readSession(env, request);
  if (!session) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  }

  const data = await getPartnerStats(env, session.partner_slug);
  if (!data) {
    return jsonResponse({ error: 'D1 not configured' }, { status: 503 });
  }
  return jsonResponse(data);
}
