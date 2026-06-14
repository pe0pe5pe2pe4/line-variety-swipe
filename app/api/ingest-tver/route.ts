import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { inferGenre } from '@/lib/genre';

// Tver から今週放送中のバラエティ番組を取得して contents に保存する。
// content_type: 'tver' / tver_url / episode_title / broadcast_date を保存。
// スクレイピングがブロックされた場合は Claude API の Web 検索でフォールバック。
//
// タイムアウト対策：
// - 1回の実行で limit 件のみ処理（?limit=5&offset=0 で分割実行）
// - Tver への各リクエストは5秒でタイムアウト
// - タイムアウト時はその時点までの結果を返す

export const maxDuration = 25;

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const TVER_PLATFORM = 'https://platform-api.tver.jp';
const REQ_TIMEOUT_MS = 5000;
const DEFAULT_LIMIT = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// タイムアウト付き fetch
async function fetchTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

type TverEpisode = {
  title: string;
  episodeTitle: string;
  description: string;
  thumbnailUrl: string;
  tverUrl: string;
  broadcastDate: string;
  channelName: string;
};

// 日本語の放送日文字列を ISO 日付 (YYYY-MM-DD) に変換する。
// 「6月11日(水)放送」→「2026-06-11」 / 「2024年3月15日」→「2024-03-15」
// 「毎週水曜日」など日付特定不能なものは null（不明でも insert は続行）。
function parseBroadcastDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  const valid = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

  // ISO 形式 (YYYY-MM-DD / YYYY/MM/DD)
  let m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m && valid(Number(m[2]), Number(m[3]))) {
    return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  }
  // 年付き和暦表記 (YYYY年M月D日) — 年を優先するため M月D日 より先に判定
  m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m && valid(Number(m[2]), Number(m[3]))) {
    return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  }
  // 年なし和暦表記 (M月D日) → 現在の年を使用
  m = s.match(/(\d{1,2})月(\d{1,2})日/);
  if (m && valid(Number(m[1]), Number(m[2]))) {
    const year = new Date().getUTCFullYear();
    return `${year}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
  }
  // 「毎週水曜日」など特定不能 → null
  return null;
}

// Tver Platform API から全エピソードを取得（タイムアウト時は [] を返す）
async function fetchAllFromTverApi(): Promise<TverEpisode[]> {
  let createRes: Response;
  try {
    createRes = await fetchTimeout(
      `${TVER_PLATFORM}/v2/api/platform_users/browser/create`,
      {
        method: 'POST',
        headers: {
          'User-Agent': MOBILE_UA,
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-tver-platform-type': 'web',
        },
        body: 'device_type=pc',
      },
      REQ_TIMEOUT_MS
    );
  } catch {
    return [];
  }
  if (!createRes.ok) return [];
  const createJson = await createRes.json();
  const uid = createJson?.result?.platform_uid;
  const token = createJson?.result?.platform_token;
  if (!uid || !token) return [];

  await sleep(2000); // アクセス間隔 2 秒

  const params = new URLSearchParams({ platform_uid: uid, platform_token: token });
  let homeRes: Response;
  try {
    homeRes = await fetchTimeout(
      `${TVER_PLATFORM}/service/api/v1/callCategoryHome/variety?${params}`,
      { headers: { 'User-Agent': MOBILE_UA, 'x-tver-platform-type': 'web' } },
      REQ_TIMEOUT_MS
    );
  } catch {
    return [];
  }
  if (!homeRes.ok) return [];
  const homeJson = await homeRes.json();

  const episodes: TverEpisode[] = [];
  const components = homeJson?.result?.components ?? [];
  for (const comp of components) {
    for (const item of comp?.contents ?? []) {
      const c = item?.content;
      if (item?.type !== 'episode' || !c?.id) continue;
      episodes.push({
        title: String(c.seriesTitle ?? c.title ?? ''),
        episodeTitle: String(c.title ?? ''),
        description: String(c.description ?? '').slice(0, 500),
        thumbnailUrl: `https://statics.tver.jp/images/content/thumbnail/episode/small/${c.id}.jpg`,
        tverUrl: `https://tver.jp/episodes/${c.id}`,
        broadcastDate: String(c.broadcastDateLabel ?? c.broadcastProviderLabel ?? ''),
        channelName: String(c.broadcasterName ?? c.networks?.[0]?.name ?? ''),
      });
    }
  }
  return episodes;
}

// フォールバック：Claude API の Web 検索（limit 件・リクエストタイムアウト付き）
async function fetchFromClaudeWebSearch(limit: number): Promise<TverEpisode[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const client = new Anthropic();
  try {
    const response = await client.messages.create(
      {
        model: 'claude-opus-4-8',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20260209', name: 'web_search' }],
        messages: [
          {
            role: 'user',
            content:
              `今週、日本のTVerで配信中の人気バラエティ番組を${limit}件、Web検索して調べてください。` +
              '各番組について JSON 配列で title(番組名), episodeTitle(放送回), description(概要60字), ' +
              'broadcastDate(放送日), channelName(放送局) を返してください。JSON以外は出力しないでください。',
          },
        ],
      },
      { timeout: 20000 }
    );
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]) as Record<string, string>[];
    return arr.slice(0, limit).map((e) => ({
      title: String(e.title ?? ''),
      episodeTitle: String(e.episodeTitle ?? ''),
      description: String(e.description ?? '').slice(0, 500),
      thumbnailUrl: '',
      tverUrl: `https://tver.jp/search/#${encodeURIComponent(String(e.title ?? ''))}`,
      broadcastDate: String(e.broadcastDate ?? ''),
      channelName: String(e.channelName ?? ''),
    }));
  } catch {
    return [];
  }
}

type UpsertResult = {
  inserted: number;
  skippedExisting: number;
  skippedNoTitle: number;
  insertErrors: string[];
};

async function upsertEpisodes(episodes: TverEpisode[]): Promise<UpsertResult> {
  const res: UpsertResult = { inserted: 0, skippedExisting: 0, skippedNoTitle: 0, insertErrors: [] };
  if (episodes.length === 0) return res;

  // 重複チェックは tver_url かつ content_type='tver' に限定する。
  // → tv_show と同名でも tver_url が異なれば別レコードとして保存される（タイトル一致では弾かない）。
  const urls = episodes.map((e) => e.tverUrl);
  const { data: existing } = await supabase
    .from('contents')
    .select('tver_url')
    .eq('content_type', 'tver')
    .in('tver_url', urls);
  const existingUrls = new Set((existing ?? []).map((r) => r.tver_url));

  for (const ep of episodes) {
    if (!ep.title) {
      res.skippedNoTitle++;
      continue;
    }
    if (existingUrls.has(ep.tverUrl)) {
      res.skippedExisting++;
      continue;
    }
    const { error } = await supabase.from('contents').insert({
      title: ep.title,
      description: ep.description,
      thumbnail_url: ep.thumbnailUrl || 'no_image',
      content_type: 'tver',
      tver_url: ep.tverUrl,
      episode_title: ep.episodeTitle,
      broadcast_date: parseBroadcastDate(ep.broadcastDate),
      channel_name: ep.channelName,
      genre: inferGenre(ep),
      source: 'tver',
      vod_affiliate_url: '',
    });
    if (error) {
      console.error('[ingest-tver] insert error', ep.title, error);
      if (res.insertErrors.length < 5) res.insertErrors.push(`${ep.title}: ${error.message}`);
    } else {
      res.inserted++;
    }
  }
  return res;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(20, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));
  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);

  let source = 'tver_api';
  let all: TverEpisode[] = [];
  try {
    all = await fetchAllFromTverApi();
  } catch {
    all = [];
  }

  // Tver が取れなければ Claude Web 検索（limit 件のみ）にフォールバック
  if (all.length === 0) {
    source = 'claude_web_search';
    all = await fetchFromClaudeWebSearch(limit);
  }

  // この実行分（offset から limit 件）だけ処理
  const slice = all.slice(offset, offset + limit);
  const up = await upsertEpisodes(slice);

  const processed = slice.length;
  const remaining = Math.max(0, all.length - (offset + processed));
  const nextOffset = remaining > 0 ? offset + limit : null;

  console.log('[ingest-tver] done', { source, total: all.length, processed, inserted: up.inserted, insertErrors: up.insertErrors.length });

  return NextResponse.json({
    source,
    total: all.length,
    offset,
    limit,
    processed,
    inserted: up.inserted,
    skipped: up.skippedExisting + up.skippedNoTitle,
    skippedExisting: up.skippedExisting,
    skippedNoTitle: up.skippedNoTitle,
    // insert 失敗の詳細（先頭5件）。inserted:0 の原因調査用（列不足・制約違反など）。
    insertErrors: up.insertErrors,
    remaining,
    nextOffset,
  });
}
