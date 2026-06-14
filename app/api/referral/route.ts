import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

// 招待情報を返す。招待した友達が3回右スワイプするごとに招待者のスワイプ上限+50。
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
      .select('id, referral_code')
      .eq('line_user_id', userId)
      .maybeSingle();

    const referralCode = (me?.referral_code as string) ?? null;
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    const inviteUrl =
      referralCode && liffId && liffId !== 'dummy'
        ? `https://liff.line.me/${liffId}?ref=${referralCode}`
        : referralCode
          ? `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}?ref=${referralCode}`
          : null;

    let invitedCount = 0;
    let invitedRightSwipes = 0;
    if (referralCode) {
      // このコードで登録した友達
      const { data: invitees } = await supabase
        .from('users')
        .select('line_user_id')
        .eq('referred_by', referralCode);
      const inviteeIds = (invitees ?? []).map((u) => u.line_user_id as string);
      invitedCount = inviteeIds.length;

      // 友達の右スワイプ総数（ボーナス算定用）
      if (inviteeIds.length > 0) {
        const { count } = await supabase
          .from('swipes')
          .select('id', { count: 'exact', head: true })
          .eq('direction', 'right')
          .in('user_id', inviteeIds);
        invitedRightSwipes = count ?? 0;
      }
    }

    // 友達の右スワイプ3回ごとに +50（フリーミアムの布石）
    const bonusSwipes = Math.floor(invitedRightSwipes / 3) * 50;

    return NextResponse.json({
      referral_code: referralCode,
      invite_url: inviteUrl,
      invited_count: invitedCount,
      invited_right_swipes: invitedRightSwipes,
      bonus_swipes: bonusSwipes,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
