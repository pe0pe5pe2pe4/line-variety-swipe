import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';
const BATCH_LIMIT = 20;

async function fetchWikipediaVarietyTitles(continueToken?: string): Promise<{
  titles: string[];
  nextContinue?: string;
}> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'categorymembers',
    cmtitle: 'Category:日本のバラエティ番組',
    cmlimit: '50',
    cmtype: 'page',
    format: 'json',
    origin: '*',
    ...(continueToken ? { cmcontinue: continueToken } : {}),
  });

  const res = await fetch(`${WIKIPEDIA_API}?${params}`);
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
  const continueToken = searchParams.get('continue') ?? undefined;

  const { titles, nextContinue } = await fetchWikipediaVarietyTitles(continueToken);

  let inserted = 0;
  let skipped = 0;

  for (const rawTitle of titles.slice(0, BATCH_LIMIT)) {
    if (inserted >= BATCH_LIMIT) break;

    const title = rawTitle.replace(/\s*\(.*?\)\s*$/, '').trim();

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

  return NextResponse.json({ inserted, skipped, nextContinue: nextContinue ?? null });
}
