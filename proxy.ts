import { NextRequest, NextResponse } from 'next/server';

// /admin と /api/admin を Basic 認証で保護する（ADMIN_PASSWORD）。
// Next.js 16: middleware は proxy に名称変更（機能は同じ）。
export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

function unauthorized(message = 'Authentication required') {
  return new NextResponse(message, {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="baraoshi-admin", charset="UTF-8"' },
  });
}

export function proxy(req: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    return new NextResponse('ADMIN_PASSWORD not configured', { status: 503 });
  }

  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Basic ')) return unauthorized();

  try {
    const decoded = atob(header.slice(6)); // "user:pass"
    const pass = decoded.slice(decoded.indexOf(':') + 1);
    if (pass === password) return NextResponse.next();
  } catch {
    // フォールスルー
  }
  return unauthorized('Invalid credentials');
}
