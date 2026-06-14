import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { searchTMDBShow } from '@/lib/tmdb';

const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';
const BATCH = 20;

async function searchWikipediaImage(title: string): Promise<string> {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'pageimages',
    pithumbsize: '500',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!res.ok) return '';
  const data = await res.json();
  const pages = data?.query?.pages ?? {};
  const page = Object.values(pages)[0] as { thumbnail?: { source: string } } | undefined;
  return page?.thumbnail?.source ?? '';
}

// 局別フォールバック画像（placehold.co でロゴ風プレースホルダー）
const BROADCASTER_FALLBACKS: Record<string, string> = {
  ntv:  'https://placehold.co/400x600/003087/ffffff?text=NTV',
  ex:   'https://placehold.co/400x600/00a0e9/ffffff?text=EX',
  tbs:  'https://placehold.co/400x600/e60012/ffffff?text=TBS',
  tx:   'https://placehold.co/400x600/00a650/ffffff?text=TX',
  cx:   'https://placehold.co/400x600/ff6600/ffffff?text=CX',
  default: 'https://placehold.co/400x600/1a1a2e/ffffff?text=TV',
};

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // thumbnail_urlが空の番組を取得
  const { data: targets, error } = await supabase
    .from('contents')
    .select('id, title')
    .or('thumbnail_url.is.null,thumbnail_url.eq.')
    .limit(BATCH);

  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!targets || targets.length === 0) {
    return NextResponse.json({ message: '空の画像なし・すべて解決済み', fixed: 0 });
  }

  let fixed = 0;
  let fallback = 0;
  const results: { title: string; source: string }[] = [];

  for (const row of targets) {
    const title = row.title as string;

    // 1. TMDBで検索
    let url = (await searchTMDBShow(title)).thumbnail_url;
    let source = 'tmdb';

    // 2. TMDBになければWikipediaで検索
    if (!url) {
      url = await searchWikipediaImage(title);
      source = 'wikipedia';
    }

    // 3. どちらもなければフォールバック画像
    if (!url) {
      url = BROADCASTER_FALLBACKS.default;
      source = 'fallback';
      fallback++;
    }

    const { error: updateError } = await supabase
      .from('contents')
      .update({ thumbnail_url: url })
      .eq('id', row.id);

    if (!updateError) {
      fixed++;
      results.push({ title, source });
    }
  }

  const remaining = await supabase
    .from('contents')
    .select('id', { count: 'exact', head: true })
    .or('thumbnail_url.is.null,thumbnail_url.eq.');

  return NextResponse.json({
    fixed,
    fallback,
    remaining: remaining.count ?? '不明',
    results,
  });
}
