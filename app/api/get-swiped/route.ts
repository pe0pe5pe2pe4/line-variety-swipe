import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

// そのユーザーがスワイプ済みの content_id を全件返す（exclude 用の信頼できる情報源）。
// LINEの user_id が取れない場合は空配列を返す。
// GET ?user_id=<line_user_id>
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  if (!userId) return NextResponse.json({ contentIds: [] });

  try {
    const { data, error } = await supabase
      .from('swipes')
      .select('content_id')
      .eq('user_id', userId);
    if (error) return NextResponse.json({ contentIds: [], error: error.message }, { status: 500 });

    const contentIds = [...new Set((data ?? []).map((s) => s.content_id as string).filter(Boolean))];
    return NextResponse.json({ contentIds });
  } catch (e) {
    return NextResponse.json({ contentIds: [], error: String(e) }, { status: 500 });
  }
}
