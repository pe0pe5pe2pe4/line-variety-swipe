import { NextResponse } from 'next/server';

// 同一IPからのリクエストを 1分間に MAX 回までに制限（インメモリの固定ウィンドウ）。
const WINDOW_MS = 60_000;
const DEFAULT_MAX = 60;

const hits = new Map<string, number[]>();

function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function rateLimit(req: Request, max = DEFAULT_MAX): { ok: boolean; retryAfter?: number } {
  const ip = getClientIp(req);
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= max) {
    hits.set(ip, recent);
    const retryAfter = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    return { ok: false, retryAfter };
  }

  recent.push(now);
  hits.set(ip, recent);

  // 肥大化防止
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return { ok: true };
}

export function rateLimited(retryAfter?: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests' },
    { status: 429, headers: retryAfter ? { 'Retry-After': String(retryAfter) } : {} }
  );
}
