import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';
import {
  FREE_DAILY_SWIPE_LIMIT,
  FREE_WATCHLATER_LIMIT,
  isPremiumActive,
  todaysSwipeCount,
  type UserPremiumRow,
} from '@/lib/premium';

// ユーザーの課金状態・本日のスワイプ状況を返す（クライアントの制限UI用）。
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  let isPremium = false;
  let dailyCount = 0;
  let abGroup = 'A';
  let onboarded = false;
  try {
    const { data } = await supabase
      .from('users')
      .select('is_premium, premium_until, daily_swipe_count, last_swipe_date, ab_group, onboarded_at')
      .eq('line_user_id', userId)
      .maybeSingle();
    const row = (data as UserPremiumRow & { ab_group?: string | null; onboarded_at?: string | null }) ?? null;
    isPremium = isPremiumActive(row);
    dailyCount = todaysSwipeCount(row);
    if (row?.ab_group === 'B') abGroup = 'B';
    onboarded = !!row?.onboarded_at;
  } catch {
    // プレミアム/ab_group/onboarded_at 列が無い場合はデフォルト扱い
  }

  const remaining = isPremium ? null : Math.max(0, FREE_DAILY_SWIPE_LIMIT - dailyCount);
  return NextResponse.json({
    isPremium,
    dailyCount,
    swipeLimit: isPremium ? null : FREE_DAILY_SWIPE_LIMIT,
    remaining,
    limitReached: !isPremium && dailyCount >= FREE_DAILY_SWIPE_LIMIT,
    watchLaterLimit: isPremium ? null : FREE_WATCHLATER_LIMIT,
    abGroup,
    onboarded,
  });
}
