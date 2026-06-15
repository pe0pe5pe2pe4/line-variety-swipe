import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveGenre, NORMALIZED_GENRES } from '@/lib/genre';
import { hasValidThumbnail } from '@/lib/types';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

export const maxDuration = 25;

// ジャンル別の充足率＋データ品質サマリーを返す（TASK6）。
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  // 全コンテンツをページングで取得
  type Row = {
    title: string;
    description?: string | null;
    channel_name?: string | null;
    content_type?: string | null;
    genre?: string | null;
    thumbnail_url?: string | null;
    enriched_description?: string | null;
  };
  const all: Row[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('contents')
      .select('title, description, channel_name, content_type, genre, thumbnail_url, enriched_description')
      .range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error }, { status: 500 });
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  const empty = () => ({ total: 0, youtube: 0, tver: 0, tv_show: 0 });
  const byGenre: Record<string, ReturnType<typeof empty>> = {};
  for (const g of NORMALIZED_GENRES) byGenre[g] = empty();

  // データ品質カウント
  let enrichedNull = 0;
  let noImage = 0;
  let genreNull = 0;
  const byType: Record<string, number> = {};

  for (const c of all) {
    const g = resolveGenre(c);
    const bucket = byGenre[g] ?? (byGenre[g] = empty());
    bucket.total++;
    if (c.content_type === 'youtube') bucket.youtube++;
    else if (c.content_type === 'tver') bucket.tver++;
    else bucket.tv_show++;

    if (!(c.enriched_description ?? '').trim()) enrichedNull++;
    if (!hasValidThumbnail(c.thumbnail_url)) noImage++;
    if (!(c.genre ?? '').trim()) genreNull++;
    const t = c.content_type ?? 'tv_show';
    byType[t] = (byType[t] ?? 0) + 1;
  }

  // 優先的に修正すべき項目（件数の多い順）
  const priorities = [
    { item: 'enriched_description が未設定', count: enrichedNull, action: '/api/enrich-contents?limit=20 を繰り返す' },
    { item: 'thumbnail が無い/no_image', count: noImage, action: '/api/fix-images・/api/ingest-* で画像補完' },
    { item: 'genre が未設定', count: genreNull, action: '/api/backfill-genre を実行' },
  ]
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    totalContents: all.length,
    genres: Object.entries(byGenre).map(([genre, v]) => ({ genre, ...v })),
    quality: {
      enrichedNull,
      noImage,
      genreNull,
      byContentType: byType,
    },
    priorities,
  });
}
