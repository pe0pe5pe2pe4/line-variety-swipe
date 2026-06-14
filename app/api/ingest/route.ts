import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { searchTMDBShow } from '@/lib/tmdb';

const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';
// 15件×平均600ms ≈ 9秒（Vercelタイムアウト余裕あり）
const BATCH_SIZE = 15;

const VARIETY_CATEGORIES = [
  '日本テレビのバラエティ番組',
  'テレビ朝日のバラエティ番組',
  'TBSのバラエティ番組',
  'テレビ東京のバラエティ番組',
  'フジテレビのバラエティ番組',
];

const CATEGORY_BROADCASTER: Record<string, string> = {
  '日本テレビのバラエティ番組': 'ntv',
  'テレビ朝日のバラエティ番組': 'ex',
  'TBSのバラエティ番組': 'tbs',
  'テレビ東京のバラエティ番組': 'tx',
  'フジテレビのバラエティ番組': 'cx',
};

// カテゴリの全タイトルをページネーションで全件取得
async function fetchAllCategoryTitles(category: string): Promise<string[]> {
  const allTitles: string[] = [];
  let continueToken: string | undefined;

  do {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:${category}`,
      cmlimit: '500',
      cmtype: 'page',
      format: 'json',
      origin: '*',
      ...(continueToken ? { cmcontinue: continueToken } : {}),
    });

    const res = await fetch(`${WIKIPEDIA_API}?${params}`);
    if (!res.ok) break;
    const data = await res.json();
    const titles: string[] = (data?.query?.categorymembers ?? []).map(
      (m: { title: string }) => m.title
    );
    allTitles.push(...titles);
    continueToken = data?.continue?.cmcontinue;
  } while (continueToken);

  return allTitles;
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

async function fetchWikipediaImage(title: string): Promise<string> {
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

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  // catIndex: 対象カテゴリ（0=日テレ, 1=テレ朝, 2=TBS, 3=テレ東, 4=フジ）
  const catIndex = parseInt(searchParams.get('catIndex') ?? '0', 10);
  // batch: バッチ番号（0始まり、15件ずつ）
  const batch = parseInt(searchParams.get('batch') ?? '0', 10);

  const category = VARIETY_CATEGORIES[catIndex];
  if (!category) {
    return NextResponse.json(
      {
        error: 'invalid catIndex (0-4)',
        usage: '/api/ingest?catIndex=0&batch=0',
        categories: VARIETY_CATEGORIES.map((c, i) => `${i}: ${c}`),
      },
      { status: 400 }
    );
  }

  // カテゴリの全タイトルを取得（内部でページネーション）
  const allRawTitles = await fetchAllCategoryTitles(category);
  const total = allRawTitles.length;

  // バッチ N の範囲を処理
  const batchRawTitles = allRawTitles.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);

  if (batchRawTitles.length === 0) {
    const nextCatIndex = catIndex + 1 < VARIETY_CATEGORIES.length ? catIndex + 1 : null;
    return NextResponse.json({
      category,
      batch,
      total,
      processed: 0,
      inserted: 0,
      skipped: 0,
      nextBatch: null,
      nextCatIndex,
      hint: nextCatIndex !== null
        ? `/api/ingest?catIndex=${nextCatIndex}&batch=0`
        : 'all categories complete',
    });
  }

  // 括弧付き曖昧回避を除去してクリーンタイトルに変換
  const cleanedTitles = batchRawTitles.map((t) =>
    t.replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim()
  );

  // 一括重複チェック（N+1クエリ回避）
  const { data: existingRows } = await supabase
    .from('contents')
    .select('title')
    .in('title', cleanedTitles);
  const existingSet = new Set((existingRows ?? []).map((r) => r.title));

  let inserted = 0;
  let skipped = 0;
  const errors: { title: string; error: string }[] = [];
  const broadcaster = CATEGORY_BROADCASTER[category] ?? 'other';

  for (let i = 0; i < batchRawTitles.length; i++) {
    const rawTitle = batchRawTitles[i];
    const title = cleanedTitles[i];

    if (existingSet.has(title)) {
      skipped++;
      continue;
    }

    const { tmdb_id, thumbnail_url: tmdbThumb, description: tmdbDesc } = await searchTMDBShow(title);
    const description = tmdbDesc || (await fetchWikipediaDescription(rawTitle));
    const thumbnail_url = tmdbThumb || (await fetchWikipediaImage(rawTitle));

    const { error } = await supabase.from('contents').insert({
      title,
      description,
      thumbnail_url,
      tmdb_id,
      source: broadcaster,
      vod_affiliate_url: '',
    });

    if (error) {
      if (error.code === '23505') {
        skipped++;
      } else {
        if (errors.length < 3) errors.push({ title, error: JSON.stringify(error) });
        skipped++;
      }
    } else {
      inserted++;
    }
  }

  const nextBatch = (batch + 1) * BATCH_SIZE < total ? batch + 1 : null;
  const nextCatIndex =
    nextBatch === null && catIndex + 1 < VARIETY_CATEGORIES.length ? catIndex + 1 : null;

  return NextResponse.json({
    category,
    batch,
    total,
    processed: batchRawTitles.length,
    inserted,
    skipped,
    errors: errors.length > 0 ? errors : undefined,
    nextBatch,
    nextCatIndex,
    hint: nextBatch !== null
      ? `/api/ingest?catIndex=${catIndex}&batch=${nextBatch}`
      : nextCatIndex !== null
      ? `/api/ingest?catIndex=${nextCatIndex}&batch=0`
      : 'all done',
  });
}
