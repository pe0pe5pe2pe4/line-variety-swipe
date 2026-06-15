import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { inferGenre } from '@/lib/genre';
import { searchTMDBShow } from '@/lib/tmdb';

// Wikipedia「日本のバラエティ番組」カテゴリから番組を取り込む。
// ?batch=0 から順に叩く（1バッチ20件）。既存番組はタイトルでスキップ。
// 画像は TMDB で補完。認証は CRON_SECRET。

export const maxDuration = 25;

const BATCH_SIZE = 100;
const WP_TITLE_CHUNK = 50; // Wikipedia API は1リクエスト最大50タイトル
const CATEGORY = 'Category:日本のバラエティ番組';
const WP_API = 'https://ja.wikipedia.org/w/api.php';
const TIMEOUT_MS = 8000;
const DEADLINE_MS = 22000; // 残り時間が無くなったら途中で打ち切る

// 画像補完：日本語(ja-JP)→英語(en-US)の順で検索し、最初に見つかった画像を使う
async function tmdbImage(title: string): Promise<{ thumbnail: string; description: string }> {
  try {
    const ja = await searchTMDBShow(title, 'ja-JP');
    if (ja.thumbnail_url) return { thumbnail: ja.thumbnail_url, description: ja.description };
    const en = await searchTMDBShow(title, 'en-US');
    if (en.thumbnail_url) return { thumbnail: en.thumbnail_url, description: ja.description || en.description };
    return { thumbnail: '', description: ja.description || en.description };
  } catch {
    return { thumbnail: '', description: '' };
  }
}

async function wpFetch(params: Record<string, string>): Promise<Record<string, unknown> | null> {
  const url = `${WP_API}?${new URLSearchParams({ ...params, format: 'json', origin: '*' })}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'baraoshi/1.0' } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// カテゴリメンバーのタイトル一覧を必要数まで取得
async function fetchCategoryTitles(minCount: number): Promise<string[]> {
  const titles: string[] = [];
  let cont: string | undefined;
  for (let i = 0; i < 5 && titles.length < minCount; i++) {
    const params: Record<string, string> = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: CATEGORY,
      cmlimit: '500',
      cmtype: 'page',
    };
    if (cont) params.cmcontinue = cont;
    const data = await wpFetch(params);
    if (!data) break;
    const members = ((data.query as Record<string, unknown>)?.categorymembers ?? []) as { title: string }[];
    for (const m of members) titles.push(m.title);
    cont = (data.continue as Record<string, string> | undefined)?.cmcontinue;
    if (!cont) break;
  }
  return titles;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// 概要（イントロ）をまとめて取得（50件ずつ）
async function fetchExtracts(titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunk(titles, WP_TITLE_CHUNK)) {
    const data = await wpFetch({
      action: 'query',
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      titles: part.join('|'),
    });
    const pages = ((data?.query as Record<string, unknown>)?.pages ?? {}) as Record<string, { title: string; extract?: string }>;
    for (const p of Object.values(pages)) {
      if (p.title) out.set(p.title, (p.extract ?? '').slice(0, 500));
    }
  }
  return out;
}

// wikitext の infobox から出演者を抽出（ベストエフォート・50件ずつ）
async function fetchCast(titles: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const part of chunk(titles, WP_TITLE_CHUNK)) {
  const data = await wpFetch({
    action: 'query',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    titles: part.join('|'),
  });
  const pages = ((data?.query as Record<string, unknown>)?.pages ?? {}) as Record<
    string,
    { title: string; revisions?: { slots?: { main?: { ['*']?: string } } }[] }
  >;
  for (const p of Object.values(pages)) {
    const content = p.revisions?.[0]?.slots?.main?.['*'] ?? '';
    const m = content.match(/(?:出演者|出演)\s*=\s*([^\n|]+)/);
    if (m) {
      const names = m[1]
        .replace(/\[\[|\]\]/g, '')
        .replace(/<[^>]+>/g, '、')
        .split(/[、,]/)
        .map((s) => s.split('|').pop()!.trim())
        .filter((s) => s && s.length <= 20)
        .slice(0, 10);
      if (names.length) out.set(p.title, names);
    }
  }
  }
  return out;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const batch = Math.max(0, parseInt(searchParams.get('batch') ?? '0', 10) || 0);

  // このバッチに必要な件数まで取得して slice
  const allTitles = await fetchCategoryTitles((batch + 1) * BATCH_SIZE);
  const slice = allTitles.slice(batch * BATCH_SIZE, batch * BATCH_SIZE + BATCH_SIZE);
  if (slice.length === 0) {
    return NextResponse.json({ batch, processed: 0, inserted: 0, message: 'これ以上の番組はありません', nextBatch: null });
  }

  // 既存タイトルを除外
  const { data: existing } = await supabase.from('contents').select('title').in('title', slice);
  const existingTitles = new Set((existing ?? []).map((r) => r.title));
  const newTitles = slice.filter((t) => !existingTitles.has(t));

  const started = Date.now();
  const [extracts, casts] = await Promise.all([fetchExtracts(newTitles), fetchCast(newTitles)]);

  let inserted = 0;
  let skipped = slice.length - newTitles.length;
  let processedNew = 0;
  for (const title of newTitles) {
    // 残り時間が無くなったら途中で打ち切る（次回バッチで続き）
    if (Date.now() - started > DEADLINE_MS) break;
    processedNew++;

    let description = extracts.get(title) ?? '';
    // TMDB で画像・概要を補完（日本語→英語、ポスター無ければバックドロップ）
    const { thumbnail, description: tmdbDesc } = await tmdbImage(title);
    if (!description && tmdbDesc) description = tmdbDesc;

    const cast = casts.get(title) ?? null;
    const { error } = await supabase.from('contents').insert({
      title,
      description: description.slice(0, 500),
      thumbnail_url: thumbnail || 'no_image',
      content_type: 'tv_show',
      source: 'wikipedia',
      genre: inferGenre({ title, description }),
      cast_names: cast,
      vod_affiliate_url: '',
    });
    if (error) skipped++;
    else inserted++;
  }

  return NextResponse.json({
    batch,
    batchSize: BATCH_SIZE,
    fetchedTitles: allTitles.length,
    processed: slice.length,
    processedNew,
    inserted,
    skipped,
    nextBatch: allTitles.length > (batch + 1) * BATCH_SIZE ? batch + 1 : null,
  });
}
