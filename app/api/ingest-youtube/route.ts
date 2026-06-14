import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { TV_CHANNELS, COMEDIAN_CHANNELS, ChannelConfig } from '@/lib/youtube-channels';

const YT_API = 'https://www.googleapis.com/youtube/v3';
const VIDEOS_PER_CHANNEL = 10;

type VideoItem = {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  channelTitle: string;
};

// チャンネルIDから動画を取得（order: viewCount or date）
async function fetchVideosByChannelId(
  channelId: string,
  apiKey: string,
  maxResults: number,
  order: 'viewCount' | 'date'
): Promise<VideoItem[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    channelId,
    type: 'video',
    order,
    maxResults: String(maxResults),
    key: apiKey,
  });
  const res = await fetch(`${YT_API}/search?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (data.error) return [];

  return (data.items ?? [])
    .map((item: Record<string, unknown>) => {
      const id = item.id as Record<string, string>;
      const snippet = item.snippet as Record<string, unknown>;
      const thumbnails = snippet?.thumbnails as Record<string, { url: string }> | undefined;
      const videoId = id?.videoId ?? '';
      if (!videoId) return null;
      return {
        videoId,
        title: String(snippet?.title ?? ''),
        description: String(snippet?.description ?? '').slice(0, 500),
        thumbnailUrl:
          thumbnails?.maxres?.url ??
          thumbnails?.high?.url ??
          thumbnails?.medium?.url ??
          '',
        channelTitle: String(snippet?.channelTitle ?? ''),
      };
    })
    .filter(Boolean) as VideoItem[];
}

// キーワードでチャンネルIDを解決 → 動画取得
async function fetchVideosByChannelSearch(
  query: string,
  apiKey: string,
  maxResults: number,
  order: 'viewCount' | 'date'
): Promise<VideoItem[]> {
  const chParams = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'channel',
    maxResults: '1',
    key: apiKey,
  });
  const chRes = await fetch(`${YT_API}/search?${chParams}`);
  if (!chRes.ok) return [];
  const chData = await chRes.json();
  const channelId = chData.items?.[0]?.id?.channelId;
  if (!channelId) return [];

  return fetchVideosByChannelId(channelId, apiKey, maxResults, order);
}

// 動画キーワード直接検索（チャンネルID不要）
async function fetchVideosByKeyword(
  query: string,
  apiKey: string,
  maxResults: number
): Promise<VideoItem[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    order: 'date',
    maxResults: String(maxResults),
    regionCode: 'JP',
    relevanceLanguage: 'ja',
    key: apiKey,
  });
  const res = await fetch(`${YT_API}/search?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (data.error) return [];

  return (data.items ?? [])
    .map((item: Record<string, unknown>) => {
      const id = item.id as Record<string, string>;
      const snippet = item.snippet as Record<string, unknown>;
      const thumbnails = snippet?.thumbnails as Record<string, { url: string }> | undefined;
      const videoId = id?.videoId ?? '';
      if (!videoId) return null;
      return {
        videoId,
        title: String(snippet?.title ?? ''),
        description: String(snippet?.description ?? '').slice(0, 500),
        thumbnailUrl:
          thumbnails?.maxres?.url ??
          thumbnails?.high?.url ??
          thumbnails?.medium?.url ??
          '',
        channelTitle: String(snippet?.channelTitle ?? ''),
      };
    })
    .filter(Boolean) as VideoItem[];
}

// チャンネル設定1件を処理
async function processChannel(
  channel: ChannelConfig,
  apiKey: string
): Promise<{ videos: VideoItem[]; resolvedVia: string }> {
  // videoQuery: 動画直接検索（公式チャンネルなし芸人など）
  if (channel.videoQuery) {
    const videos = await fetchVideosByKeyword(channel.videoQuery, apiKey, VIDEOS_PER_CHANNEL);
    return { videos, resolvedVia: 'video_keyword' };
  }

  // channel ID 指定あり → 先にID直接取得
  if (channel.id) {
    const videos = await fetchVideosByChannelId(
      channel.id, apiKey, VIDEOS_PER_CHANNEL, channel.order
    );
    if (videos.length > 0) return { videos, resolvedVia: 'channel_id' };
  }

  // searchQuery → チャンネルID解決 → 動画取得
  if (channel.searchQuery) {
    const videos = await fetchVideosByChannelSearch(
      channel.searchQuery, apiKey, VIDEOS_PER_CHANNEL, channel.order
    );
    if (videos.length > 0) return { videos, resolvedVia: 'channel_search' };
  }

  return { videos: [], resolvedVia: 'failed' };
}

async function upsertVideos(
  videos: VideoItem[],
  channel: ChannelConfig
): Promise<{ inserted: number; skipped: number }> {
  if (videos.length === 0) return { inserted: 0, skipped: 0 };

  const youtubeUrls = videos.map((v) => `https://www.youtube.com/watch?v=${v.videoId}`);

  // 一括重複チェック
  const { data: existing } = await supabase
    .from('contents')
    .select('youtube_url')
    .in('youtube_url', youtubeUrls);
  const existingUrls = new Set((existing ?? []).map((r) => r.youtube_url));

  let inserted = 0;
  let skipped = 0;

  for (const video of videos) {
    const youtubeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
    if (existingUrls.has(youtubeUrl)) {
      skipped++;
      continue;
    }

    const { error } = await supabase.from('contents').insert({
      title: video.title,
      description: video.description,
      thumbnail_url: video.thumbnailUrl,
      content_type: 'youtube',
      youtube_url: youtubeUrl,
      channel_name: video.channelTitle || channel.name,
      source: channel.category,
      vod_affiliate_url: '',
    });

    if (error && error.code !== '23505') {
      skipped++;
    } else if (!error) {
      inserted++;
    } else {
      skipped++;
    }
  }

  return { inserted, skipped };
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  // batch=0: テレビ局公式（再生回数上位、Cronデフォルト）
  // batch=1: 芸人チャンネル（最新順）
  const batch = parseInt(searchParams.get('batch') ?? '0', 10);

  const targetChannels = batch === 1 ? COMEDIAN_CHANNELS : TV_CHANNELS;
  const batchLabel = batch === 1 ? '芸人チャンネル' : 'テレビ局公式';

  let totalInserted = 0;
  let totalSkipped = 0;
  const channelResults: {
    channel: string;
    resolvedVia: string;
    inserted: number;
    skipped: number;
  }[] = [];
  const errors: { channel: string; error: string }[] = [];

  for (const channel of targetChannels) {
    try {
      const { videos, resolvedVia } = await processChannel(channel, apiKey);
      const { inserted, skipped } = await upsertVideos(videos, channel);

      channelResults.push({ channel: channel.name, resolvedVia, inserted, skipped });
      totalInserted += inserted;
      totalSkipped += skipped;
    } catch (e) {
      if (errors.length < 5) errors.push({ channel: channel.name, error: String(e) });
    }
  }

  return NextResponse.json({
    batch,
    batchLabel,
    totalInserted,
    totalSkipped,
    channels: channelResults,
    errors: errors.length > 0 ? errors : undefined,
    nextBatch: batch === 0 ? 1 : null,
  });
}
