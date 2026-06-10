// Конструктор Request с типичными заголовками Cloudflare.

export function makeRequest(url, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has('CF-Connecting-IP')) {
    headers.set('CF-Connecting-IP', init.ip || '1.2.3.4');
  }
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', init.userAgent || 'KP-Test/1.0');
  }
  return new Request(url, {
    method: init.method || 'GET',
    headers,
    body: init.body !== undefined
      ? (typeof init.body === 'string' ? init.body : JSON.stringify(init.body))
      : undefined
  });
}

export function jsonPost(url, body, init = {}) {
  return makeRequest(url, {
    ...init,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    body
  });
}
