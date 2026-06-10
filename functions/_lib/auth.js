// Общие хелперы аутентификации партнёров.
// Используются в functions/api/auth/* и в защищённых эндпоинтах кабинета.

const SESSION_TTL_SECONDS = 30 * 24 * 3600; // 30 дней
const COOKIE_NAME = 'kp_session';

// Cryptographically random token (Web Crypto, доступно в Workers runtime).
function randomToken(byteLength = 32) {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

// 6-значный код. Без 0 в первой позиции — чтобы не сбрасывалось при копировании.
function generateOtpCode() {
  const buf = new Uint8Array(3);
  crypto.getRandomValues(buf);
  let n = ((buf[0] << 16) | (buf[1] << 8) | buf[2]) % 900000 + 100000;
  return String(n);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// Извлечь session-token из cookie запроса.
function readSessionCookie(request) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq) === COOKIE_NAME) return part.slice(eq + 1);
  }
  return null;
}

function buildSessionCookie(token, ttlSeconds = SESSION_TTL_SECONDS) {
  const maxAge = Math.max(0, ttlSeconds);
  return `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

// Возвращает { partner_slug, role, token } или null.
// role: 'partner' (по умолчанию) | 'owner'.
async function readSession(env, request) {
  if (!env.DB) return null;
  const token = readSessionCookie(request);
  if (!token) return null;

  const row = await env.DB.prepare(
    'SELECT partner_slug, expires_at, role FROM sessions WHERE token = ?'
  ).bind(token).first();

  if (!row) return null;
  if (row.expires_at < nowSec()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }

  // Лениво продлеваем last_seen (раз в сутки достаточно).
  const last = await env.DB.prepare(
    'SELECT last_seen_at FROM sessions WHERE token = ?'
  ).bind(token).first();
  if (last && nowSec() - last.last_seen_at > 24 * 3600) {
    await env.DB.prepare(
      'UPDATE sessions SET last_seen_at = ? WHERE token = ?'
    ).bind(nowSec(), token).run();
  }

  return {
    partner_slug: row.partner_slug,
    role: row.role || 'partner',
    token
  };
}

// Создаёт owner-сессию. partner_slug = '__owner__' (placeholder, NOT NULL).
async function createOwnerSession(env, telegram_id, request) {
  const token = randomToken(32);
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO sessions (token, partner_slug, role, created_at, expires_at, last_seen_at, ip_first, ua_first)
     VALUES (?, '__owner__', 'owner', ?, ?, ?, ?, ?)`
  ).bind(
    token,
    now,
    now + SESSION_TTL_SECONDS,
    now,
    request.headers.get('CF-Connecting-IP') || '',
    request.headers.get('User-Agent') || ''
  ).run();
  return token;
}

async function createSession(env, partner_slug, request) {
  const token = randomToken(32);
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO sessions (token, partner_slug, created_at, expires_at, last_seen_at, ip_first, ua_first)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    token,
    partner_slug,
    now,
    now + SESSION_TTL_SECONDS,
    now,
    request.headers.get('CF-Connecting-IP') || '',
    request.headers.get('User-Agent') || ''
  ).run();
  return token;
}

async function destroySession(env, token) {
  if (!env.DB || !token) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

function jsonResponse(data, opts = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(opts.headers || {})
  });
  if (opts.setCookie) headers.append('Set-Cookie', opts.setCookie);
  return new Response(JSON.stringify(data), { status: opts.status || 200, headers });
}

// HOF для защиты эндпоинтов кабинета.
function requireSession(handler) {
  return async (ctx) => {
    const session = await readSession(ctx.env, ctx.request);
    if (!session) {
      return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    }
    ctx.session = session;
    return handler(ctx);
  };
}

// Проверяет, что telegram_user_id в whitelist OWNER_TELEGRAM_IDS (CSV в env).
function isOwnerTelegramId(env, telegram_id) {
  const csv = (env.OWNER_TELEGRAM_IDS || '').trim();
  if (!csv) return false;
  const ids = csv.split(',').map(s => parseInt(s.trim(), 10)).filter(Boolean);
  return ids.includes(Number(telegram_id));
}

// HOF для админ-эндпоинтов: требует session.role === 'owner'.
function requireOwner(handler) {
  return async (ctx) => {
    const session = await readSession(ctx.env, ctx.request);
    if (!session) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
    if (session.role !== 'owner') return jsonResponse({ error: 'forbidden' }, { status: 403 });
    ctx.session = session;
    return handler(ctx);
  };
}

// Лог админ-действий. Не падает, если DB недоступна.
async function logAdminAction(env, telegram_id, action, targetType, targetId, payload) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO admin_log (actor_telegram_id, action, target_type, target_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      telegram_id,
      action,
      targetType || null,
      targetId ? String(targetId) : null,
      payload ? JSON.stringify(payload) : null,
      nowSec()
    ).run();
  } catch (e) { console.error('admin_log error', e); }
}

export {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  nowSec,
  randomToken,
  generateOtpCode,
  readSessionCookie,
  buildSessionCookie,
  clearSessionCookie,
  readSession,
  createSession,
  createOwnerSession,
  destroySession,
  jsonResponse,
  requireSession,
  requireOwner,
  isOwnerTelegramId,
  logAdminAction
};
