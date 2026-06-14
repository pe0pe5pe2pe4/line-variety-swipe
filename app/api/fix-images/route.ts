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

// TMDB・Wikipedia両方で画像が見つからなかった場合のセンチネル値
// placehold.co を使うと次回のバッチでも再検出されてしまう無限ループになるため使用しない
const NOT_FOUND_SENTINEL = 'not_found';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // thumbnail_urlが空・null・プレースホルダー（placehold.co）の番組を取得
  const { data: targets, error } = await supabase
    .from('contents')
    .select('id, title')
    .or('thumbnail_url.is.null,thumbnail_url.eq.,thumbnail_url.ilike.%placehold.co%')
    .limit(BATCH);

  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!targets || targets.length === 0) {
    return NextResponse.json({ message: '修正対象なし・すべて解決済み', fixed: 0 });
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

    // 3. どちらも見つからなければセンチネル値をセット（再処理ループを防ぐ）
    if (!url) {
      url = NOT_FOUND_SENTINEL;
      source = 'not_found';
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
    .or('thumbnail_url.is.null,thumbnail_url.eq.,thumbnail_url.ilike.%placehold.co%');

  return NextResponse.json({
    fixed,
    fallback,
    remaining: remaining.count ?? '不明',
    results,
  });
}
