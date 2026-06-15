import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';
import { PREMIUM_DAYS } from '@/lib/premium';

// プレミアムへのアップグレード。
// 現状はモック（is_premium=true にするだけ）。将来 Stripe Checkout の
// webhook 完了後にこの更新を行う前提で設計（user_id で users 行を特定）。
// POST { user_id }
export async function POST(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  let body: { user_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const userId = body.user_id;
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  // TODO(Stripe): ここを Checkout Session 完了 webhook から呼ぶ。
  //   - stripe.checkout.sessions.create({ mode:'subscription', price: ... })
  //   - webhook(checkout.session.completed) で本更新を実行
  const premiumUntil = new Date(Date.now() + PREMIUM_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('users')
    .update({ is_premium: true, premium_until: premiumUntil })
    .eq('line_user_id', userId);

  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ success: true, is_premium: true, premium_until: premiumUntil });
}
