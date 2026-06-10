// POST /api/auth/logout

import {
  clearSessionCookie,
  destroySession,
  jsonResponse,
  readSessionCookie
} from '../../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const token = readSessionCookie(request);
  await destroySession(env, token);
  return jsonResponse({ ok: true }, { setCookie: clearSessionCookie() });
}
