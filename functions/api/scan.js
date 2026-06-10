// POST /api/scan — фиксация скана QR
// Body: { partner_slug, session_id, ua }
//
// Rate-limit: 100 сканов/час с одного IP. Защищает от ботов накачивающих счётчик.

import { getIP, rateLimit } from '../_lib/ratelimit.js';
import { jsonResponse, nowSec } from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { partner_slug, session_id, ua } = body;

    if (!partner_slug || !session_id) {
      return jsonResponse({ error: 'bad_request' }, { status: 400 });
    }

    const ip = getIP(request);
    const limit = await rateLimit(env, `scan:${ip}`, 100, 3600);
    if (!limit.ok) {
      return jsonResponse(
        { error: 'rate_limited', retryAfter: limit.retryAfter },
        { status: 429 }
      );
    }

    if (env.DB) {
      await env.DB.prepare(
        'INSERT INTO scans (partner_slug, session_id, user_agent, ip, scanned_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(partner_slug, session_id, ua || '', ip, nowSec()).run();
    }

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: e.message }, { status: 500 });
  }
}
