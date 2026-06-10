// GET /api/admin/disputes/list — список активных диспутов для собственника.

import { jsonResponse, readSession } from '../../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const session = await readSession(env, request);
  if (!session) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  if (session.role !== 'owner') return jsonResponse({ error: 'forbidden' }, { status: 403 });
  if (!env.DB) return jsonResponse({ error: 'd1_unavailable' }, { status: 503 });

  const { results } = await env.DB.prepare(
    `SELECT l.id, l.partner_slug, l.child_age, l.status, l.dispute_reason,
            l.submitted_at, l.status_changed_at,
            p.name AS partner_name, p.city AS partner_city, p.mr_name
       FROM leads l
       JOIN partners p ON p.slug = l.partner_slug
      WHERE l.dispute_reason IS NOT NULL AND l.dispute_reason != ''
   ORDER BY l.status_changed_at DESC NULLS LAST
      LIMIT 100`
  ).all();

  return jsonResponse({ disputes: results || [] });
}
