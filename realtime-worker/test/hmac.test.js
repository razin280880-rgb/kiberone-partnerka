import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signToken, verifyToken } from '../src/hmac.js';

const SECRET = 'test-secret-do-not-use-in-prod';

describe('signToken / verifyToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-10T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('подписывает и верифицирует туда-обратно', async () => {
    const token = await signToken(SECRET, { audience: 'partner:stomat_chln_01', ttlSec: 300 });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const payload = await verifyToken(SECRET, token);
    expect(payload).toBeTruthy();
    expect(payload.audience).toBe('partner:stomat_chln_01');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('null при чужом секрете (HMAC не сходится)', async () => {
    const token = await signToken(SECRET, { audience: 'owner', ttlSec: 300 });
    const wrong = await verifyToken('OTHER_SECRET', token);
    expect(wrong).toBeNull();
  });

  it('null при истёкшем токене', async () => {
    const token = await signToken(SECRET, { audience: 'owner', ttlSec: 10 });
    vi.advanceTimersByTime(20_000);
    const expired = await verifyToken(SECRET, token);
    expect(expired).toBeNull();
  });

  it('null при изменении полезной нагрузки', async () => {
    const token = await signToken(SECRET, { audience: 'partner:a', ttlSec: 300 });
    // Подменим payload на другой audience, оставим ту же подпись
    const [body, sig] = token.split('.');
    const tampered = btoa(JSON.stringify({ audience: 'partner:b', exp: 9999999999 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + sig;
    const result = await verifyToken(SECRET, tampered);
    expect(result).toBeNull();
  });

  it('null при невалидном формате', async () => {
    expect(await verifyToken(SECRET, '')).toBeNull();
    expect(await verifyToken(SECRET, 'nope')).toBeNull();
    expect(await verifyToken(SECRET, 'a.b.c')).toBeNull();
    expect(await verifyToken(SECRET, null)).toBeNull();
  });

  it('audience может содержать сложные символы (slug, role)', async () => {
    const token = await signToken(SECRET, { audience: 'partner:stomat-chln_01' });
    const p = await verifyToken(SECRET, token);
    expect(p.audience).toBe('partner:stomat-chln_01');
  });

  it('exp по умолчанию = now + ttlSec', async () => {
    const token = await signToken(SECRET, { audience: 'owner', ttlSec: 600 });
    const p = await verifyToken(SECRET, token);
    expect(p.exp).toBe(Math.floor(Date.now() / 1000) + 600);
  });
});
