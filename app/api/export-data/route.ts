import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

// GDPR を意識したユーザーデータエクスポート。
// そのユーザーの全スワイプ履歴・右スワイプ番組一覧・スワイプ統計を JSON で返す。
// GET ?user_id=<line_user_id>
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  try {
    const { data: swipes } = await supabase
      .from('swipes')
      .select('content_id, direction, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const all = (swipes ?? []) as { content_id: string; direction: string; created_at: string }[];
    const rightIds = [...new Set(all.filter((s) => s.direction === 'right').map((s) => s.content_id))];

    let likedPrograms: unknown[] = [];
    if (rightIds.length > 0) {
      const { data: contents } = await supabase
        .from('contents')
        .select('id, title, channel_name, content_type, genre, youtube_url, tver_url')
        .in('id', rightIds);
      likedPrograms = contents ?? [];
    }

    const stats = {
      total_swipes: all.length,
      right: all.filter((s) => s.direction === 'right').length,
      left: all.filter((s) => s.direction === 'left').length,
      up: all.filter((s) => s.direction === 'up').length,
    };

    const payload = {
      exported_at: new Date().toISOString(),
      user_id: userId,
      notice: 'このデータはあなた自身のスワイプ履歴のエクスポートです（GDPR対応）。',
      stats,
      liked_programs: likedPrograms,
      swipes: all,
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="baraoshi-export.json"',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
