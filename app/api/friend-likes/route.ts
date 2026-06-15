import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

// 招待コードで繋がった友達（自分の招待者＋自分が招待した人）が
// 右スワイプした番組の content_id 一覧を返す。
// GET ?user_id=<line_user_id>
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  try {
    const { data: me } = await supabase
      .from('users')
      .select('referral_code, referred_by')
      .eq('line_user_id', userId)
      .maybeSingle();

    const friendIds = new Set<string>();

    // 自分が招待した人（referred_by = 自分のコード）
    if (me?.referral_code) {
      const { data } = await supabase
        .from('users')
        .select('line_user_id')
        .eq('referred_by', me.referral_code);
      for (const u of data ?? []) friendIds.add(u.line_user_id as string);
    }
    // 自分の招待者（referral_code = 自分の referred_by）
    if (me?.referred_by) {
      const { data } = await supabase
        .from('users')
        .select('line_user_id')
        .eq('referral_code', me.referred_by);
      for (const u of data ?? []) friendIds.add(u.line_user_id as string);
    }
    friendIds.delete(userId);

    if (friendIds.size === 0) {
      return NextResponse.json({ friends: 0, contentIds: [] });
    }

    const { data: swipes } = await supabase
      .from('swipes')
      .select('content_id')
      .eq('direction', 'right')
      .in('user_id', [...friendIds]);

    const contentIds = [...new Set((swipes ?? []).map((s) => s.content_id as string))];
    return NextResponse.json({ friends: friendIds.size, contentIds });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
