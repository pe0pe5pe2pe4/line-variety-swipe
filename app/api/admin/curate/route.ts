import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// 人力キュレーション用キュー（proxy.ts の Basic 認証で保護）。
// GET: 未判定（curated IS NULL）のコンテンツを新着順で返す。
//      ?type=youtube|tv_show|tver で絞り込み可（既定 youtube＝動画を見て判定できるもの優先）。
// 判定の保存は /api/admin/action の type:'curate' で行う。
export const maxDuration = 25;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') ?? 'youtube';
  const limit = Math.max(1, Math.min(50, parseInt(searchParams.get('limit') ?? '20', 10) || 20));

  try {
    let query = supabase
      .from('contents')
      .select('id, title, description, thumbnail_url, youtube_url, preview_youtube_url, channel_name, content_type, genre, yt_view_count, yt_subscriber_count, curated, created_at')
      .is('curated', null)
      .not('thumbnail_url', 'eq', 'no_image')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (type !== 'all') query = query.eq('content_type', type);

    const { data, error } = await query;
    if (error) {
      // curated 列が未作成の場合は分かるメッセージで返す
      return NextResponse.json(
        {
          error: String(error.message ?? error),
          hint: '先に SQL を実行してください: ALTER TABLE contents ADD COLUMN IF NOT EXISTS curated boolean;',
        },
        { status: 500 }
      );
    }

    // 残り件数（未判定の総数）
    const { count } = await supabase
      .from('contents')
      .select('id', { count: 'exact', head: true })
      .is('curated', null)
      .not('thumbnail_url', 'eq', 'no_image');

    return NextResponse.json({ items: data ?? [], remaining: count ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
