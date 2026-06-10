// HMAC-токены для realtime WebSocket. Идентичная реализация в realtime-worker/src/hmac.js
// (можно было бы шерить как пакет, но для двух мест проще скопировать).

function utf8(s) {
  return new TextEncoder().encode(s);
}

function b64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Подписать токен (используется в /api/realtime/ws-token).
 * Возвращает строку вида "<b64url(json)>.<b64url(hmac)>".
 */
async function signToken(secret, payload) {
  const exp = payload.exp || (Math.floor(Date.now() / 1000) + (payload.ttlSec || 300));
  const body = { audience: payload.audience, exp };
  const json = JSON.stringify(body);
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, utf8(json));
  return b64url(utf8(json)) + '.' + b64url(sig);
}

export { signToken };
