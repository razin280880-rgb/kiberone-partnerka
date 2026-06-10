import { describe, it, expect } from 'vitest';
import {
  generateOtpCode,
  randomToken,
  readSessionCookie,
  buildSessionCookie,
  clearSessionCookie,
  COOKIE_NAME
} from '../../functions/_lib/auth.js';

describe('generateOtpCode', () => {
  it('возвращает строку из 6 цифр', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateOtpCode();
      expect(c).toMatch(/^[1-9][0-9]{5}$/);
    }
  });

  it('различающиеся коды (по крайней мере 5 уникальных из 10)', () => {
    const codes = new Set();
    for (let i = 0; i < 10; i++) codes.add(generateOtpCode());
    expect(codes.size).toBeGreaterThanOrEqual(5);
  });
});

describe('randomToken', () => {
  it('hex-строка длиной 2*byteLength', () => {
    expect(randomToken(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomToken(32)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('два вызова дают разные токены', () => {
    expect(randomToken(32)).not.toBe(randomToken(32));
  });
});

describe('cookie helpers', () => {
  it('readSessionCookie возвращает значение из заголовка', () => {
    const req = new Request('https://x', {
      headers: { Cookie: `foo=bar; ${COOKIE_NAME}=abc123; baz=quux` }
    });
    expect(readSessionCookie(req)).toBe('abc123');
  });

  it('readSessionCookie → null, если cookie нет', () => {
    const req = new Request('https://x');
    expect(readSessionCookie(req)).toBeNull();
  });

  it('buildSessionCookie помечает HttpOnly Secure SameSite=Strict', () => {
    const c = buildSessionCookie('TOK', 3600);
    expect(c).toContain(`${COOKIE_NAME}=TOK`);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Strict');
    expect(c).toContain('Max-Age=3600');
  });

  it('clearSessionCookie ставит Max-Age=0', () => {
    expect(clearSessionCookie()).toContain('Max-Age=0');
  });
});
