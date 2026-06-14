import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { inferGenre } from '@/lib/genre';

// Tver から今週放送中のバラエティ番組を取得して contents に保存する。
// content_type: 'tver' / tver_url / episode_title / broadcast_date を保存。
// スクレイピングがブロックされた場合は Claude API の Web 検索でフォールバック。

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const TVER_PLATFORM = 'https://platform-api.tver.jp';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type TverEpisode = {
  title: string;
  episodeTitle: string;
  description: string;
  thumbnailUrl: string;
  tverUrl: string;
  broadcastDate: string;
  channelName: string;
};

// ── Tver Platform API（公開フロント API）経由で取得 ──
async function fetchFromTverApi(): Promise<TverEpisode[]> {
  // 1) ブラウザユーザーを作成して platform_uid / platform_token を取得
  const createRes = await fetch(`${TVER_PLATFORM}/v2/api/platform_users/browser/create`, {
    method: 'POST',
    headers: {
      'User-Agent': MOBILE_UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-tver-platform-type': 'web',
    },
    body: 'device_type=pc',
  });
  if (!createRes.ok) return [];
  const createJson = await createRes.json();
  const uid = createJson?.result?.platform_uid;
  const token = createJson?.result?.platform_token;
  if (!uid || !token) return [];

  await sleep(2000); // アクセス間隔 2 秒

  // 2) バラエティカテゴリのホームを取得
  const params = new URLSearchParams({ platform_uid: uid, platform_token: token });
  const homeRes = await fetch(
    `${TVER_PLATFORM}/service/api/v1/callCategoryHome/variety?${params}`,
    {
      headers: {
        'User-Agent': MOBILE_UA,
        'x-tver-platform-type': 'web',
      },
    }
  );
  if (!homeRes.ok) return [];
  const homeJson = await homeRes.json();

  // components[].contents[].content から episode を抽出
  const episodes: TverEpisode[] = [];
  const components = homeJson?.result?.components ?? [];
  for (const comp of components) {
    for (const item of comp?.contents ?? []) {
      const c = item?.content;
      const type = item?.type;
      if (type !== 'episode' || !c?.id) continue;
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

// ── フォールバック：Claude API の Web 検索で現在のバラエティ番組情報を取得 ──
async function fetchFromClaudeWebSearch(): Promise<TverEpisode[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content:
            '今週、日本のTVerで配信中の人気バラエティ番組を10件、Web検索して調べてください。' +
            '各番組について JSON 配列で title(番組名), episodeTitle(放送回), description(概要60字), ' +
            'broadcastDate(放送日), channelName(放送局) を返してください。JSON以外は出力しないでください。',
        },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]) as Record<string, string>[];
    return arr.map((e) => ({
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

async function upsertEpisodes(episodes: TverEpisode[]): Promise<{ inserted: number; skipped: number }> {
  if (episodes.length === 0) return { inserted: 0, skipped: 0 };

  const urls = episodes.map((e) => e.tverUrl);
  const { data: existing } = await supabase
    .from('contents')
    .select('tver_url')
    .in('tver_url', urls);
  const existingUrls = new Set((existing ?? []).map((r) => r.tver_url));

  let inserted = 0;
  let skipped = 0;
  for (const ep of episodes) {
    if (!ep.title || existingUrls.has(ep.tverUrl)) {
      skipped++;
      continue;
    }
    const { error } = await supabase.from('contents').insert({
      title: ep.title,
      description: ep.description,
      thumbnail_url: ep.thumbnailUrl || 'no_image',
      content_type: 'tver',
      tver_url: ep.tverUrl,
      episode_title: ep.episodeTitle,
      broadcast_date: ep.broadcastDate,
      channel_name: ep.channelName,
      genre: inferGenre(ep),
      source: 'tver',
      vod_affiliate_url: '',
    });
    if (error) skipped++;
    else inserted++;
  }
  return { inserted, skipped };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let source = 'tver_api';
  let episodes: TverEpisode[] = [];
  try {
    episodes = await fetchFromTverApi();
  } catch {
    episodes = [];
  }

  // ブロック等で取得できなければ Claude Web 検索にフォールバック
  if (episodes.length === 0) {
    source = 'claude_web_search';
    episodes = await fetchFromClaudeWebSearch();
  }

  const { inserted, skipped } = await upsertEpisodes(episodes);

  return NextResponse.json({
    source,
    found: episodes.length,
    inserted,
    skipped,
  });
}
