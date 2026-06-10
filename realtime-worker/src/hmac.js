// Подписанные токены для WebSocket-аутентификации.
// Формат: base64url(JSON{audience, exp}) + '.' + base64url(hmac_sha256)
//
// Pages выдаёт токен через /api/realtime/ws-token, клиент кладёт в ?token=...
// Worker верифицирует HMAC общим секретом REALTIME_SHARED_SECRET.

function utf8(s) {
  return new TextEncoder().encode(s);
}

function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function getKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// timingSafeEqual для Uint8Array.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Подписать токен с TTL.
 * @param secret — общий секрет (REALTIME_SHARED_SECRET).
 * @param payload — { audience, exp } или { audience, ttlSec }.
 */
async function signToken(secret, payload) {
  const exp = payload.exp || (Math.floor(Date.now() / 1000) + (payload.ttlSec || 300));
  const body = { audience: payload.audience, exp };
  const json = JSON.stringify(body);
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, utf8(json));
  return b64url(utf8(json)) + '.' + b64url(sig);
}

/**
 * Верифицировать токен. Возвращает payload или null.
 */
async function verifyToken(secret, token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  let bodyBytes, sig;
  try {
    bodyBytes = b64urlDecode(parts[0]);
    sig = b64urlDecode(parts[1]);
  } catch {
    return null;
  }

  const key = await getKey(secret);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, bodyBytes));
  if (!timingSafeEqual(sig, expected)) return null;

  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bodyBytes)); }
  catch { return null; }

  if (!payload.audience || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export { signToken, verifyToken, b64url, b64urlDecode };
