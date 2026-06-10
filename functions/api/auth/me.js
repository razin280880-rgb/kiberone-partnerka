// GET /api/auth/me — кто я (для кабинета: проверка, что сессия живая).

import { jsonResponse, readSession } from '../../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const session = await readSession(env, request);
  if (!session) {
    return jsonResponse({ authenticated: false }, { status: 200 });
  }
  if (!env.DB) {
    return jsonResponse({ authenticated: true, partner_slug: session.partner_slug });
  }
  const partner = await env.DB.prepare(
    'SELECT slug, name, city, tier FROM partners WHERE slug = ?'
  ).bind(session.partner_slug).first();
  return jsonResponse({
    authenticated: true,
    partner_slug: session.partner_slug,
    partner
  });
}
