import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { inferGenre } from '@/lib/genre';

export const maxDuration = 25;

// 発掘の追撃ingest：右スワイプを多く集めた YouTube チャンネル（＝刺さっている発掘元）を特定し、
// そのチャンネルの最新動画をさらに取り込んで供給を増やす。
// 「当たったチャンネルの同系統を増やす」ことで、初回の寄せ集め感を解消していく。
// 認証は CRON_SECRET。
const YT_API = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 7000;
const DEADLINE_MS = 22000;
const TOP_CHANNELS = 5;
const VIDEOS_PER_CHANNEL = 10;

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

async function resolveChannelId(name: string, apiKey: string): Promise<string | null> {
  const params = new URLSearchParams({ part: 'snippet', q: name, type: 'channel', maxResults: '1', key: apiKey });
  const res = await ytFetch(`${YT_API}/search?${params}`);
  if (!res || !res.ok) return null;
  const data = await res.json();
  return data.items?.[0]?.id?.channelId ?? null;
}

type Vid = { videoId: string; title: string; description: string; thumbnailUrl: string; channelTitle: string };

async function fetchChannelVideos(channelId: string, apiKey: string): Promise<Vid[]> {
  const params = new URLSearchParams({
    part: 'snippet', channelId, type: 'video', order: 'date',
    maxResults: String(VIDEOS_PER_CHANNEL), key: apiKey,
  });
  const res = await ytFetch(`${YT_API}/search?${params}`);
  if (!res || !res.ok) return [];
  const data = await res.json();
  if (data.error) return [];
  return ((data.items ?? []) as Record<string, unknown>[])
    .map((item) => {
      const id = item.id as Record<string, string>;
      const s = item.snippet as Record<string, unknown> | undefined;
      const th = s?.thumbnails as Record<string, { url: string }> | undefined;
      const videoId = id?.videoId ?? '';
      if (!videoId) return null;
      return {
        videoId,
        title: String(s?.title ?? ''),
        description: String(s?.description ?? '').slice(0, 500),
        thumbnailUrl: th?.high?.url ?? th?.medium?.url ?? th?.default?.url ?? '',
        channelTitle: String(s?.channelTitle ?? ''),
      };
    })
    .filter(Boolean) as Vid[];
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' }, { status: 500 });

  // 右スワイプされた youtube コンテンツのチャンネル別カウント
  const { data: rights } = await supabase.from('swipes').select('content_id').eq('direction', 'right');
  const rightIds = [...new Set((rights ?? []).map((s) => s.content_id as string))];
  if (rightIds.length === 0) return NextResponse.json({ message: '右スワイプがまだありません', channels: [] });

  const channelScore = new Map<string, number>();
  for (let i = 0; i < rightIds.length; i += 300) {
    const chunk = rightIds.slice(i, i + 300);
    const { data: cs } = await supabase
      .from('contents')
      .select('channel_name, content_type')
      .in('id', chunk);
    for (const c of (cs ?? []) as { channel_name: string | null; content_type: string | null }[]) {
      if (c.content_type !== 'youtube') continue;
      const ch = (c.channel_name ?? '').trim();
      if (ch) channelScore.set(ch, (channelScore.get(ch) ?? 0) + 1);
    }
  }

  const topChannels = [...channelScore.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, TOP_CHANNELS)
    .map(([name]) => name);

  const started = Date.now();
  let inserted = 0;
  const processedChannels: { channel: string; added: number }[] = [];

  for (const name of topChannels) {
    if (Date.now() - started > DEADLINE_MS) break;
    const channelId = await resolveChannelId(name, apiKey);
    if (!channelId) { processedChannels.push({ channel: name, added: 0 }); continue; }
    const vids = await fetchChannelVideos(channelId, apiKey);
    if (vids.length === 0) { processedChannels.push({ channel: name, added: 0 }); continue; }

    const urls = vids.map((v) => `https://www.youtube.com/watch?v=${v.videoId}`);
    const { data: existing } = await supabase.from('contents').select('youtube_url').in('youtube_url', urls);
    const existingUrls = new Set((existing ?? []).map((r) => r.youtube_url));

    let added = 0;
    for (const v of vids) {
      const url = `https://www.youtube.com/watch?v=${v.videoId}`;
      if (existingUrls.has(url)) continue;
      const { error } = await supabase.from('contents').insert({
        title: v.title,
        description: v.description,
        thumbnail_url: v.thumbnailUrl || 'no_image',
        youtube_url: url,
        channel_name: v.channelTitle || name,
        content_type: 'youtube',
        source: 'discovery_grow',
        genre: inferGenre(v),
        vod_affiliate_url: '',
      });
      if (!error) { added++; inserted++; }
    }
    processedChannels.push({ channel: name, added });
  }

  return NextResponse.json({ topChannels, inserted, channels: processedChannels });
}
