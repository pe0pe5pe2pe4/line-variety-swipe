import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveGenre, NORMALIZED_GENRES } from '@/lib/genre';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

export const maxDuration = 25;

// ジャンル別の充足率を返す（各ジャンルの番組数・YouTube数・Tver数・tv_show数）。
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  // 全コンテンツをページングで取得
  type Row = { title: string; description?: string | null; channel_name?: string | null; content_type?: string | null; genre?: string | null };
  const all: Row[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('contents')
      .select('title, description, channel_name, content_type, genre')
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

  for (const c of all) {
    const g = resolveGenre(c);
    const bucket = byGenre[g] ?? (byGenre[g] = empty());
    bucket.total++;
    if (c.content_type === 'youtube') bucket.youtube++;
    else if (c.content_type === 'tver') bucket.tver++;
    else bucket.tv_show++;
  }

  return NextResponse.json({
    totalContents: all.length,
    genres: Object.entries(byGenre).map(([genre, v]) => ({ genre, ...v })),
  });
}
