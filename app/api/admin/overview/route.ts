import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveGenre } from '@/lib/genre';

// 管理画面用の集計＋コンテンツ一覧（middleware の Basic 認証で保護）。
export const maxDuration = 25;

export async function GET() {
  try {
    const [{ count: userCount }, { count: swipeCount }, { count: clickCount }] = await Promise.all([
      supabase.from('users').select('id', { count: 'exact', head: true }),
      supabase.from('swipes').select('id', { count: 'exact', head: true }),
      supabase.from('affiliate_clicks').select('id', { count: 'exact', head: true }),
    ]);

    // スワイプ集計（content_id ごとの right/total）
    const { data: swipes } = await supabase.from('swipes').select('content_id, direction');
    const right = new Map<string, number>();
    const total = new Map<string, number>();
    for (const s of (swipes ?? []) as { content_id: string; direction: string }[]) {
      total.set(s.content_id, (total.get(s.content_id) ?? 0) + 1);
      if (s.direction === 'right') right.set(s.content_id, (right.get(s.content_id) ?? 0) + 1);
    }

    // コンテンツ一覧（最大300件）
    const { data: contents } = await supabase
      .from('contents')
      .select('id, title, channel_name, content_type, genre, description, thumbnail_url')
      .limit(300);

    const list = ((contents ?? []) as Record<string, unknown>[]).map((c) => {
      const id = c.id as string;
      const t = total.get(id) ?? 0;
      const r = right.get(id) ?? 0;
      return {
        id,
        title: c.title as string,
        genre: resolveGenre(c as { title: string; description?: string | null; channel_name?: string | null; content_type?: string | null; genre?: string | null }),
        content_type: (c.content_type as string) ?? 'tv_show',
        swipes: t,
        likes: r,
        likeRate: t > 0 ? Math.round((r / t) * 100) : null,
        hidden: c.thumbnail_url === 'no_image',
      };
    });
    list.sort((a, b) => b.swipes - a.swipes);

    return NextResponse.json({
      totals: {
        users: userCount ?? 0,
        swipes: swipeCount ?? 0,
        clicks: clickCount ?? 0,
        contents: list.length,
      },
      contents: list,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
