import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';
import {
  FREE_DAILY_SWIPE_LIMIT,
  isPremiumActive,
  jstDateString,
  todaysSwipeCount,
  type UserPremiumRow,
} from '@/lib/premium';

// あとで見るリスト: 右スワイプしたコンテンツ一覧を返す
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  const { data: swipes, error: swipeError } = await supabase
    .from('swipes')
    .select('content_id')
    .eq('user_id', userId)
    .eq('direction', 'right')
    .order('created_at', { ascending: false });

  if (swipeError) return NextResponse.json({ error: swipeError }, { status: 500 });
  if (!swipes?.length) return NextResponse.json([]);

  // 重複除去
  const seen = new Set<string>();
  const contentIds: string[] = [];
  for (const s of swipes) {
    if (!seen.has(s.content_id)) {
      seen.add(s.content_id);
      contentIds.push(s.content_id);
    }
  }

  const { data: contents, error: contentError } = await supabase
    .from('contents')
    .select('*')
    .in('id', contentIds);

  if (contentError) return NextResponse.json({ error: contentError }, { status: 500 });

  // スワイプ順（最新優先）に並べ替え
  const contentMap = new Map((contents ?? []).map((c: { id: string }) => [c.id, c]));
  const sorted = contentIds.map((id) => contentMap.get(id)).filter(Boolean);

  return NextResponse.json(sorted);
}

export async function POST(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const { user_id, content_id, direction, onboarding } = await request.json();

  if (!user_id || !content_id || !direction) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  // ── フリーミアム：日次スワイプ上限の判定（プレミアム列が無くても落ちないよう try/catch）──
  let isPremium = false;
  let dailyCount = 0;
  let userRow: (UserPremiumRow & { id?: string }) | null = null;
  try {
    const { data } = await supabase
      .from('users')
      .select('id, is_premium, premium_until, daily_swipe_count, last_swipe_date')
      .eq('line_user_id', user_id)
      .maybeSingle();
    userRow = (data as UserPremiumRow & { id?: string }) ?? null;
    isPremium = isPremiumActive(userRow);
    dailyCount = todaysSwipeCount(userRow);
  } catch {
    // プレミアム列が未作成などの場合はゲートせず通常動作にフォールバック
    userRow = null;
  }

  // オンボーディング中のスワイプは上限にカウントしない
  const counts = !onboarding;

  // 無料ユーザーが上限到達 → スワイプを記録せず limitReached を返す
  if (counts && userRow && !isPremium && dailyCount >= FREE_DAILY_SWIPE_LIMIT) {
    return NextResponse.json({
      success: false,
      limitReached: true,
      isPremium: false,
      dailyCount,
      limit: FREE_DAILY_SWIPE_LIMIT,
    });
  }

  const { error } = await supabase.from('swipes').insert({
    user_id,
    content_id,
    direction,
    created_at: new Date().toISOString(),
  });

  // 23505 = unique_violation（同一コンテンツの再スワイプ）は既に記録済みなので成功扱い
  if (error && error.code !== '23505') {
    return NextResponse.json({ error }, { status: 500 });
  }

  // 日次カウントを更新（列が無ければ握りつぶす）
  let newCount = dailyCount;
  if (counts && userRow) {
    newCount = dailyCount + 1;
    try {
      await supabase
        .from('users')
        .update({ daily_swipe_count: newCount, last_swipe_date: jstDateString() })
        .eq('line_user_id', user_id);
    } catch {
      // プレミアム列未作成時は無視
    }
  }

  return NextResponse.json({
    success: true,
    isPremium,
    dailyCount: newCount,
    limit: FREE_DAILY_SWIPE_LIMIT,
    limitReached: counts && !isPremium && newCount >= FREE_DAILY_SWIPE_LIMIT,
  });
}