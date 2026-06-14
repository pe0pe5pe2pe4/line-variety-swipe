import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { searchTMDBShow } from '@/lib/tmdb';

export const maxDuration = 25;

const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';
const BATCH = 20;

// センチネル値
// 'not_found' = TMDB+Wikipedia失敗（YouTube未試行） → 次回のfix-imagesでYouTubeを試す
// 'no_image'  = 全手段を試して失敗 → 再試行しない最終状態
const FINAL_SENTINEL = 'no_image';

const BROADCASTER_LOGOS: Record<string, string> = {
  ntv: 'https://www.ntv.co.jp/favicon.ico',
  ex:  'https://www.tv-asahi.co.jp/favicon.ico',
  tbs: 'https://www.tbs.co.jp/favicon.ico',
  tx:  'https://www.tv-tokyo.co.jp/favicon.ico',
  cx:  'https://www.fujitv.co.jp/favicon.ico',
};

async function searchWikipediaImage(title: string): Promise<string> {
  try {
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
  } catch {
    return '';
  }
}

async function searchYouTubeThumbnail(title: string): Promise<string> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return '';
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      q: `${title} 公式`,
      type: 'video',
      maxResults: '1',
      key,
    });
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!res.ok) return '';
    const data = await res.json();
    const item = data?.items?.[0];
    return (
      item?.snippet?.thumbnails?.high?.url ??
      item?.snippet?.thumbnails?.medium?.url ??
      item?.snippet?.thumbnails?.default?.url ??
      ''
    );
  } catch {
    return '';
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 対象: null / 空文字 / placehold.co / not_found（YouTube未試行）
  // no_image は対象外（全手段試済み、再試行しない）
  const { data: targets, error } = await supabase
    .from('contents')
    .select('id, title, thumbnail_url, source')
    .or('thumbnail_url.is.null,thumbnail_url.eq.,thumbnail_url.ilike.%placehold.co%,thumbnail_url.eq.not_found')
    .limit(BATCH);

  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!targets || targets.length === 0) {
    const { count } = await supabase
      .from('contents')
      .select('id', { count: 'exact', head: true })
      .eq('thumbnail_url', FINAL_SENTINEL);
    return NextResponse.json({
      message: '修正対象なし（null/placehold.co/not_found行なし）',
      fixed: 0,
      finalNoImage: count ?? 0,
    });
  }

  let fixed = 0;
  let failed = 0;
  const results: { title: string; imgSource: string; url: string }[] = [];

  for (const row of targets) {
    const title = row.title as string;
    const rowSource = (row.source as string) ?? '';
    const alreadyTriedBasic = row.thumbnail_url === 'not_found';

    let url = '';
    let imgSource = '';

    // Step 1: TMDB（not_foundの行はすでに試済みなのでスキップ）
    if (!alreadyTriedBasic) {
      const tmdb = await searchTMDBShow(title);
      url = tmdb.thumbnail_url;
      if (url) imgSource = 'tmdb';
    }

    // Step 2: Wikipedia（not_foundの行はすでに試済みなのでスキップ）
    if (!url && !alreadyTriedBasic) {
      url = await searchWikipediaImage(title);
      if (url) imgSource = 'wikipedia';
    }

    // Step 3: YouTube（YOUTUBE_API_KEY環境変数が必要）
    if (!url) {
      url = await searchYouTubeThumbnail(title);
      if (url) imgSource = 'youtube';
    }

    // Step 4: 放送局ロゴ（source列に局コードが入っている場合のみ）
    if (!url && BROADCASTER_LOGOS[rowSource]) {
      url = BROADCASTER_LOGOS[rowSource];
      imgSource = `broadcaster_logo(${rowSource})`;
    }

    // Step 5: 全手段失敗 → 最終センチネル（次回は再試行しない）
    if (!url) {
      url = FINAL_SENTINEL;
      imgSource = 'no_image';
      failed++;
    }

    // thumbnail_urlのみ更新。descriptionは絶対に触らない
    const { error: updateError } = await supabase
      .from('contents')
      .update({ thumbnail_url: url })
      .eq('id', row.id);

    if (!updateError) {
      fixed++;
      results.push({ title, imgSource, url });
    }
  }

  const remaining = await supabase
    .from('contents')
    .select('id', { count: 'exact', head: true })
    .or('thumbnail_url.is.null,thumbnail_url.eq.,thumbnail_url.ilike.%placehold.co%,thumbnail_url.eq.not_found');

  return NextResponse.json({
    fixed,
    failed,
    remaining: remaining.count ?? 0,
    hasYouTubeKey: !!process.env.YOUTUBE_API_KEY,
    results,
  });
}
