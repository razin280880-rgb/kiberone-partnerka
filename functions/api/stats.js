// GET /api/stats?slug=demo_chln_01 — статистика партнёра для кабинета
// GET /api/stats?type=live&city=chln — общий live-счётчик города для лендинга

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

async function getLiveCount(env, city) {
  if (!env.DB) return { todayCount: 47 + Math.floor(Math.random() * 20) };
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
  if (!env.DB) {
    // Mock: пусть фронт сам подложит моки. Возвращаем минимум для смешивания.
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
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

  return {
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

  if (type === 'live') {
    const city = url.searchParams.get('city') || 'chln';
    const data = await getLiveCount(env, city);
    return jsonResponse(data);
  }

  const slug = url.searchParams.get('slug');
  if (!slug) return jsonResponse({ error: 'slug required' }, 400);

  const data = await getPartnerStats(env, slug);
  if (!data) return jsonResponse({ error: 'D1 not configured — use mocks' }, 503);
  return jsonResponse(data);
}
