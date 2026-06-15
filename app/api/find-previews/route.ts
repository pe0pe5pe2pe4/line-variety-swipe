import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const maxDuration = 25;

// Tver/番組コンテンツに対し、YouTube を検索して「公式チャンネルのクリップ」を
// 見つけ preview_youtube_url に保存する。見つからなければ 'none'（=画像にフォールバック）。
// 事前に: ALTER TABLE contents ADD COLUMN IF NOT EXISTS preview_youtube_url text;
// ?limit（既定20・最大30）/ 認証は CRON_SECRET。
const YT_API = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 6000;
const DEADLINE_MS = 22000;

async function ytFetch(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

type Row = { id: string; title: string; channel_name: string | null };

// 番組名で検索し、公式（channelTitleに「公式」or放送局名を含む）を優先して動画URLを返す
async function findOfficialVideo(title: string, channel: string | null, apiKey: string): Promise<string | null> {
  const params = new URLSearchParams({
    part: 'snippet',
    q: `${title} 公式`,
    type: 'video',
    order: 'relevance',
    maxResults: '5',
    regionCode: 'JP',
    relevanceLanguage: 'ja',
    key: apiKey,
  });
  const res = await ytFetch(`${YT_API}/search?${params}`);
  if (!res || !res.ok) return null;
  const data = await res.json();
  if (data.error) return null;
  const items = (data.items ?? []) as { id?: { videoId?: string }; snippet?: { channelTitle?: string } }[];
  if (items.length === 0) return null;

  const official = items.find((it) => {
    const ch = it.snippet?.channelTitle ?? '';
    return ch.includes('公式') || (channel && ch.includes(channel));
  });
  const chosen = official ?? items[0];
  const vid = chosen?.id?.videoId;
  return vid ? `https://www.youtube.com/watch?v=${vid}` : null;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(30, parseInt(searchParams.get('limit') ?? '20', 10) || 20));

  // youtube 以外（tver / tv_show / null）で preview 未取得の行
  const { data, error } = await supabase
    .from('contents')
    .select('id, title, channel_name')
    .or('content_type.eq.tver,content_type.eq.tv_show,content_type.is.null')
    .is('preview_youtube_url', null)
    .limit(limit);
  if (error) return NextResponse.json({ error }, { status: 500 });

  const rows = (data ?? []) as Row[];
  const { count: remainingBefore } = await supabase
    .from('contents')
    .select('id', { count: 'exact', head: true })
    .or('content_type.eq.tver,content_type.eq.tv_show,content_type.is.null')
    .is('preview_youtube_url', null);

  const started = Date.now();
  let found = 0;
  let notFound = 0;
  let processed = 0;
  for (const r of rows) {
    if (Date.now() - started > DEADLINE_MS) break;
    processed++;
    let url: string | null = null;
    try {
      url = await findOfficialVideo(r.title, r.channel_name, apiKey);
    } catch {
      url = null;
    }
    // 見つからなければ 'none' を入れて再検索を防ぎ、画像にフォールバックさせる
    await supabase.from('contents').update({ preview_youtube_url: url ?? 'none' }).eq('id', r.id);
    if (url) found++;
    else notFound++;
  }

  return NextResponse.json({
    processed,
    found,
    notFound,
    remaining: Math.max(0, (remainingBefore ?? rows.length) - processed),
  });
}
