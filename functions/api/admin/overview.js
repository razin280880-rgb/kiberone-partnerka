// GET /api/admin/overview?period=week|month|all
// Возвращает агрегированные метрики для owner-дашборда:
//   - 7 городов: сканы, анкеты, пробные, оплаты, ₽ начислено
//   - воронка: total funnel и city-by-city
//   - топ-5 партнёров недели/месяца
//   - боттом-5 (≥7 дней без анкет)
//   - 12 недель динамики
//   - активные диспуты (счётчик)
//   - performance МР

import { jsonResponse, readSession, nowSec } from '../../_lib/auth.js';

const CITIES = [
  { key: 'chln',  name: 'Челны' },
  { key: 'nkmsk', name: 'Нижнекамск' },
  { key: 'kzn',   name: 'Казань' },
  { key: 'elb',   name: 'Елабуга' },
  { key: 'krd',   name: 'Краснодар' },
  { key: 'srg',   name: 'Сургут' },
  { key: 'prm',   name: 'Пермь' }
];

function rangeFromPeriod(period) {
  const now = nowSec();
  if (period === 'all') return { from: 0, to: now };
  if (period === 'month') return { from: now - 30 * 24 * 3600, to: now };
  return { from: now - 7 * 24 * 3600, to: now };  // week
}

async function cityRow(env, cityKey, from, to) {
  const leadsRow = await env.DB.prepare(
    `SELECT COUNT(*) AS leads,
            SUM(CASE WHEN status IN ('trial_came','paid') THEN 1 ELSE 0 END) AS trials,
            SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
            COALESCE(SUM(reward_anketa+COALESCE(reward_trial,0)+COALESCE(reward_paid,0)),0) AS amount
       FROM leads
      WHERE city = ? AND submitted_at >= ? AND submitted_at < ?`
  ).bind(cityName(cityKey), from, to).first();
  const scansRow = await env.DB.prepare(
    `SELECT COUNT(*) AS scans
       FROM scans
      WHERE partner_slug LIKE ? AND scanned_at >= ? AND scanned_at < ?`
  ).bind(`%_${cityKey}_%`, from, to).first();
  const partnersRow = await env.DB.prepare(
    "SELECT COUNT(*) AS active_partners FROM partners WHERE city = ? AND status = 'active'"
  ).bind(cityKey).first();
  return {
    city: cityKey,
    cityName: cityName(cityKey),
    scans: scansRow?.scans || 0,
    leads: leadsRow?.leads || 0,
    trials: leadsRow?.trials || 0,
    paid: leadsRow?.paid || 0,
    amount: leadsRow?.amount || 0,
    activePartners: partnersRow?.active_partners || 0
  };
}

function cityName(key) {
  const c = CITIES.find(c => c.key === key);
  return c ? c.name : key;
}

async function topPartners(env, from, to, limit = 5) {
  const r = await env.DB.prepare(
    `SELECT p.slug, p.name, p.city, COUNT(l.id) AS leads,
            SUM(CASE WHEN l.status='paid' THEN 1 ELSE 0 END) AS paid
       FROM partners p
       LEFT JOIN leads l ON l.partner_slug = p.slug AND l.submitted_at >= ? AND l.submitted_at < ?
      WHERE p.status = 'active'
   GROUP BY p.slug
   ORDER BY leads DESC
      LIMIT ?`
  ).bind(from, to, limit).all();
  return r.results || [];
}

async function bottomPartners(env, daysSilent = 7, limit = 5) {
  const cutoff = nowSec() - daysSilent * 24 * 3600;
  const r = await env.DB.prepare(
    `SELECT p.slug, p.name, p.city,
            (SELECT MAX(submitted_at) FROM leads WHERE partner_slug = p.slug) AS last_lead
       FROM partners p
      WHERE p.status = 'active'
        AND (SELECT MAX(submitted_at) FROM leads WHERE partner_slug = p.slug) < ?
   ORDER BY last_lead ASC NULLS FIRST
      LIMIT ?`
  ).bind(cutoff, limit).all();
  return r.results || [];
}

async function weeklyDynamics(env, weeks = 12) {
  const now = nowSec();
  const data = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const weekEnd = now - i * 7 * 24 * 3600;
    const weekStart = weekEnd - 7 * 24 * 3600;
    const r = await env.DB.prepare(
      `SELECT COUNT(*) AS leads,
              SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
              COALESCE(SUM(reward_anketa+COALESCE(reward_trial,0)+COALESCE(reward_paid,0)),0) AS amount
         FROM leads WHERE submitted_at >= ? AND submitted_at < ?`
    ).bind(weekStart, weekEnd).first();
    const d = new Date(weekStart * 1000);
    data.push({
      label: `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`,
      leads: r?.leads || 0,
      paid: r?.paid || 0,
      amount: r?.amount || 0
    });
  }
  return data;
}

async function disputesCount(env) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM leads WHERE dispute_reason IS NOT NULL AND dispute_reason != ''"
  ).first();
  return r?.cnt || 0;
}

async function mrPerformance(env, from, to) {
  const r = await env.DB.prepare(
    `SELECT p.mr_name, p.mr_telegram,
            COUNT(DISTINCT p.slug) AS partners,
            COUNT(l.id) AS leads,
            SUM(CASE WHEN l.status='paid' THEN 1 ELSE 0 END) AS paid
       FROM partners p
       LEFT JOIN leads l ON l.partner_slug = p.slug
          AND l.submitted_at >= ? AND l.submitted_at < ?
      WHERE p.status = 'active' AND p.mr_name IS NOT NULL AND p.mr_name != ''
   GROUP BY p.mr_telegram, p.mr_name
   ORDER BY leads DESC`
  ).bind(from, to).all();
  return r.results || [];
}

export async function onRequestGet({ request, env }) {
  const session = await readSession(env, request);
  if (!session) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  if (session.role !== 'owner') return jsonResponse({ error: 'forbidden' }, { status: 403 });
  if (!env.DB) return jsonResponse({ error: 'd1_unavailable' }, { status: 503 });

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || 'week';
  const { from, to } = rangeFromPeriod(period);

  // Параллельно — заметно быстрее при 7+ городах.
  const [cities, top, bottom, dynamics, disputes, mrs] = await Promise.all([
    Promise.all(CITIES.map(c => cityRow(env, c.key, from, to))),
    topPartners(env, from, to, 5),
    bottomPartners(env, 7, 5),
    weeklyDynamics(env, 12),
    disputesCount(env),
    mrPerformance(env, from, to)
  ]);

  const total = cities.reduce((acc, c) => ({
    scans: acc.scans + c.scans,
    leads: acc.leads + c.leads,
    trials: acc.trials + c.trials,
    paid: acc.paid + c.paid,
    amount: acc.amount + c.amount,
    activePartners: acc.activePartners + c.activePartners
  }), { scans: 0, leads: 0, trials: 0, paid: 0, amount: 0, activePartners: 0 });

  return jsonResponse({
    period,
    range: { from, to },
    total,
    cities,
    topPartners: top,
    bottomPartners: bottom,
    dynamics12w: dynamics,
    activeDisputes: disputes,
    mrs
  });
}
