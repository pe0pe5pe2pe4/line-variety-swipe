import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';
const BATCH_LIMIT = 20;

// 民放各局のバラエティカテゴリ（実在するものだけ）
const VARIETY_CATEGORIES = [
  '日本テレビのバラエティ番組',
  'テレビ朝日のバラエティ番組',
  'TBSのバラエティ番組',
  'テレビ東京のバラエティ番組',
  'フジテレビのバラエティ番組',
];

async function fetchCategoryTitles(category: string, continueToken?: string): Promise<{
  titles: string[];
  nextContinue?: string;
}> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'categorymembers',
    cmtitle: `Category:${category}`,
    cmlimit: '50',
    cmtype: 'page',
    format: 'json',
    origin: '*',
    ...(continueToken ? { cmcontinue: continueToken } : {}),
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!res.ok) return { titles: [] };
  const data = await res.json();
  const titles: string[] = (data?.query?.categorymembers ?? []).map(
    (m: { title: string }) => m.title
  );
  const nextContinue = data?.continue?.cmcontinue;
  return { titles, nextContinue };
}

async function fetchWikipediaDescription(title: string): Promise<string> {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    exsentences: '3',
    format: 'json',
    origin: '*',
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!res.ok) return '';
  const data = await res.json();
  const pages = data?.query?.pages ?? {};
  const page = Object.values(pages)[0] as { extract?: string } | undefined;
  return page?.extract?.trim() ?? '';
}

async function searchTMDB(title: string): Promise<{
  tmdb_id: number | null;
  thumbnail_url: string;
  description: string;
}> {
  const tmdbKey = process.env.TMDB_API_KEY;
  if (!tmdbKey) return { tmdb_id: null, thumbnail_url: '', description: '' };

  const res = await fetch(
    `${TMDB_BASE}/search/tv?query=${encodeURIComponent(title)}&language=ja-JP`,
    { headers: { Authorization: `Bearer ${tmdbKey}` } }
  );
  if (!res.ok) return { tmdb_id: null, thumbnail_url: '', description: '' };
  const data = await res.json();
  const item = data?.results?.[0];
  if (!item) return { tmdb_id: null, thumbnail_url: '', description: '' };

  return {
    tmdb_id: item.id,
    thumbnail_url: item.poster_path
      ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
      : '',
    description: item.overview ?? '',
  };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  // catIndex: どのカテゴリを処理中か（0〜4）
  const catIndex = parseInt(searchParams.get('catIndex') ?? '0', 10);
  const continueToken = searchParams.get('continue') ?? undefined;

  const category = VARIETY_CATEGORIES[catIndex];
  if (!category) {
    return NextResponse.json({ error: 'invalid catIndex' }, { status: 400 });
  }

  const { titles, nextContinue } = await fetchCategoryTitles(category, continueToken);

  let inserted = 0;
  let skipped = 0;

  for (const rawTitle of titles.slice(0, BATCH_LIMIT)) {
    // 括弧付きの曖昧回避を除去（例: "アナザースカイ (テレビ番組)" → "アナザースカイ"）
    const title = rawTitle.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();

    const { tmdb_id, thumbnail_url, description: tmdbDesc } = await searchTMDB(title);
    const description = tmdbDesc || (await fetchWikipediaDescription(rawTitle));

    const { error } = await supabase.from('contents').upsert(
      {
        title,
        description,
        thumbnail_url,
        tmdb_id,
        source: 'wikipedia_tmdb',
        vod_affiliate_url: '',
      },
      { onConflict: 'title' }
    );

    if (error) {
      skipped++;
    } else {
      inserted++;
    }
  }

  // 次のバッチ情報（フロントエンドや手動実行で使える）
  const nextCatIndex = nextContinue ? catIndex : catIndex + 1;
  const hasMore = nextContinue != null || nextCatIndex < VARIETY_CATEGORIES.length;

  return NextResponse.json({
    category,
    inserted,
    skipped,
    nextContinue: nextContinue ?? null,
    nextCatIndex,
    hasMore,
  });
}
