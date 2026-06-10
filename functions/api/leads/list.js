// GET /api/leads/list — список анкет партнёра (для кабинета)
// Требует сессии. Берёт partner_slug из неё.
// Query: period=month|prev_month|all, status=...

import { jsonResponse, readSession, nowSec } from '../../_lib/auth.js';

function periodToRange(period) {
  const now = new Date();
  if (period === 'all') {
    return { from: 0, to: nowSec() + 60 };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'prev_month') {
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return {
      from: Math.floor(prevStart.getTime() / 1000),
      to:   Math.floor(start.getTime() / 1000)
    };
  }
  return {
    from: Math.floor(start.getTime() / 1000),
    to:   nowSec() + 60
  };
}

function fmtDate(ts) {
  const d = new Date(ts * 1000);
  return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
}

export async function onRequestGet({ request, env }) {
  const session = await readSession(env, request);
  if (!session) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  if (!env.DB) return jsonResponse({ error: 'd1_unavailable' }, { status: 503 });

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || 'month';
  const statusFilter = url.searchParams.get('status') || 'all';

  const { from, to } = periodToRange(period);

  let sql =
    `SELECT id, child_age, status, submitted_at,
            COALESCE(reward_anketa, 0) + COALESCE(reward_trial, 0) + COALESCE(reward_paid, 0) AS amount,
            dispute_reason
       FROM leads
      WHERE partner_slug = ? AND submitted_at >= ? AND submitted_at < ?`;
  const bind = [session.partner_slug, from, to];
  if (statusFilter !== 'all') {
    sql += ' AND status = ?';
    bind.push(statusFilter);
  }
  sql += ' ORDER BY submitted_at DESC LIMIT 200';

  const { results } = await env.DB.prepare(sql).bind(...bind).all();

  const leads = (results || []).map(r => ({
    id: r.id,
    date: fmtDate(r.submitted_at),
    age: r.child_age,
    status: r.status,
    amount: r.amount,
    disputed: !!r.dispute_reason,
    comment: r.dispute_reason || ''
  }));

  return jsonResponse({ leads });
}
