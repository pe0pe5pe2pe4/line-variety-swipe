import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchTMDBLastEpisode } from '@/lib/tmdb';

export const maxDuration = 25;

// 事前にSupabaseで実行してください:
// ALTER TABLE contents ADD COLUMN IF NOT EXISTS episode_number TEXT;
// ALTER TABLE contents ADD COLUMN IF NOT EXISTS episode_title TEXT;
// ALTER TABLE contents ADD COLUMN IF NOT EXISTS broadcast_date TEXT;

const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';
const BATCH_SIZE = 10;

// Wikipediaのページテキストから放送回情報を抽出
async function fetchWikipediaEpisodeInfo(title: string): Promise<{
  episode_number: string | null;
  broadcast_date: string | null;
}> {
  const params = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'extracts',
    exintro: '0',
    explaintext: '1',
    exsentences: '30',
    format: 'json',
    origin: '*',
  });

  try {
    const res = await fetch(`${WIKIPEDIA_API}?${params}`);
    if (!res.ok) return { episode_number: null, broadcast_date: null };
    const data = await res.json();
    const pages = data?.query?.pages ?? {};
    const page = Object.values(pages)[0] as { extract?: string } | undefined;
    const text = page?.extract ?? '';

    const episodeMatch = text.match(/第(\d+)[話回]/);
    const episode_number = episodeMatch ? `第${episodeMatch[1]}回` : null;

    const dateMatch = text.match(/(\d{4}年\d{1,2}月\d{1,2}日)/);
    const broadcast_date = dateMatch ? dateMatch[1] : null;

    return { episode_number, broadcast_date };
  } catch {
    return { episode_number: null, broadcast_date: null };
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const batch = parseInt(searchParams.get('batch') ?? '0', 10);

  // broadcast_date が未設定の TV番組を取得
  let rows: Array<{ id: string; title: string; tmdb_id: number | null }> = [];
  try {
    const { data, error } = await supabase
      .from('contents')
      .select('id, title, tmdb_id')
      .or('content_type.eq.tv_show,content_type.is.null')
      .is('broadcast_date', null)
      .range(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE - 1)
      .order('id');

    if (error) {
      // カラム未作成の可能性
      return NextResponse.json({
        error: error.message,
        hint: 'Run this SQL in Supabase:\nALTER TABLE contents ADD COLUMN IF NOT EXISTS episode_number TEXT;\nALTER TABLE contents ADD COLUMN IF NOT EXISTS episode_title TEXT;\nALTER TABLE contents ADD COLUMN IF NOT EXISTS broadcast_date TEXT;',
      }, { status: 500 });
    }
    rows = (data ?? []) as typeof rows;
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ batch, processed: 0, updated: 0, done: true });
  }

  let updated = 0;
  const results: { title: string; source: string; found: boolean }[] = [];

  for (const row of rows) {
    let info: {
      episode_number: string | null;
      episode_title: string | null;
      broadcast_date: string | null;
    };
    let source: string;

    if (row.tmdb_id) {
      info = await fetchTMDBLastEpisode(Number(row.tmdb_id));
      source = 'tmdb';
    } else {
      const wiki = await fetchWikipediaEpisodeInfo(row.title);
      info = { ...wiki, episode_title: null };
      source = 'wikipedia';
    }

    const hasInfo = !!(info.episode_number || info.broadcast_date);
    results.push({ title: row.title, source, found: hasInfo });

    if (hasInfo) {
      const updateData: Record<string, string> = {};
      if (info.episode_number) updateData.episode_number = info.episode_number;
      if (info.episode_title) updateData.episode_title = info.episode_title;
      if (info.broadcast_date) updateData.broadcast_date = info.broadcast_date;

      await supabase.from('contents').update(updateData).eq('id', row.id);
      updated++;
    } else {
      // 情報なし → sentinel でスキップマーク（再実行防止）
      await supabase.from('contents').update({ broadcast_date: 'unknown' }).eq('id', row.id);
    }
  }

  return NextResponse.json({
    batch,
    processed: rows.length,
    updated,
    results,
    nextBatch: rows.length === BATCH_SIZE ? batch + 1 : null,
    hint: rows.length === BATCH_SIZE ? `/api/fetch-episodes?batch=${batch + 1}` : 'done',
  });
}
