import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { YOUTUBE_CHANNELS, ChannelConfig } from '@/lib/youtube-channels';

const YT_API = 'https://www.googleapis.com/youtube/v3';
const VIDEOS_PER_CHANNEL = 5;

type VideoItem = {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  channelTitle: string;
};

// チャンネルIDから最新動画を取得
async function fetchVideosByChannelId(
  channelId: string,
  apiKey: string,
  maxResults: number
): Promise<VideoItem[]> {
  const params = new URLSearchParams({
    part: 'snippet',
    channelId,
    type: 'video',
    order: 'date',
    maxResults: String(maxResults),
    key: apiKey,
  });
  const res = await fetch(`${YT_API}/search?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (data.error) return [];

  return (data.items ?? []).map((item: Record<string, any>) => ({
    videoId: item.id?.videoId ?? '',
    title: item.snippet?.title ?? '',
    description: item.snippet?.description ?? '',
    thumbnailUrl:
      item.snippet?.thumbnails?.maxres?.url ??
      item.snippet?.thumbnails?.high?.url ??
      item.snippet?.thumbnails?.medium?.url ??
      '',
    channelTitle: item.snippet?.channelTitle ?? '',
  })).filter((v: VideoItem) => v.videoId);
}

// キーワード検索でチャンネルIDを取得し、その後動画を取得
async function fetchVideosBySearch(
  query: string,
  apiKey: string,
  maxResults: number
): Promise<VideoItem[]> {
  // まずチャンネルを検索
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

  return fetchVideosByChannelId(channelId, apiKey, maxResults);
}

// チャンネル設定1件を処理（ID試行 → 失敗時searchQueryフォールバック）
async function processChannel(
  channel: ChannelConfig,
  apiKey: string
): Promise<{ videos: VideoItem[]; resolvedVia: string }> {
  // チャンネルIDが指定されている場合は先に試す
  if (channel.id) {
    const videos = await fetchVideosByChannelId(channel.id, apiKey, VIDEOS_PER_CHANNEL);
    if (videos.length > 0) return { videos, resolvedVia: 'channel_id' };
  }

  // IDが間違っているかIDなし → searchQueryで検索フォールバック
  if (channel.searchQuery) {
    const videos = await fetchVideosBySearch(channel.searchQuery, apiKey, VIDEOS_PER_CHANNEL);
    if (videos.length > 0) return { videos, resolvedVia: 'search_fallback' };
  }

  return { videos: [], resolvedVia: 'failed' };
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

  // クエリパラメータで対象チャンネルを絞れる（省略時は全件）
  const { searchParams } = new URL(request.url);
  const channelParam = searchParams.get('channel'); // チャンネル名で絞り込み

  const targetChannels = channelParam
    ? YOUTUBE_CHANNELS.filter((c) => c.name.includes(channelParam))
    : YOUTUBE_CHANNELS;

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

      let chInserted = 0;
      let chSkipped = 0;

      for (const video of videos) {
        const youtubeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
        const title = video.title;

        // 重複チェック（youtube_url または title の重複を防ぐ）
        const { data: existing } = await supabase
          .from('contents')
          .select('id')
          .or(`youtube_url.eq.${youtubeUrl},title.eq.${title}`)
          .limit(1);

        if (existing && existing.length > 0) {
          chSkipped++;
          continue;
        }

        const { error } = await supabase.from('contents').insert({
          title,
          description: video.description.slice(0, 500),
          thumbnail_url: video.thumbnailUrl,
          content_type: 'youtube',
          youtube_url: youtubeUrl,
          channel_name: video.channelTitle || channel.name,
          source: channel.category,
          vod_affiliate_url: '',
        });

        if (error) {
          if (errors.length < 5) errors.push({ channel: channel.name, error: JSON.stringify(error) });
          chSkipped++;
        } else {
          chInserted++;
        }
      }

      channelResults.push({
        channel: channel.name,
        resolvedVia,
        inserted: chInserted,
        skipped: chSkipped,
      });
      totalInserted += chInserted;
      totalSkipped += chSkipped;
    } catch (e) {
      if (errors.length < 5) errors.push({ channel: channel.name, error: String(e) });
    }
  }

  return NextResponse.json({
    totalInserted,
    totalSkipped,
    channels: channelResults,
    errors: errors.length > 0 ? errors : undefined,
  });
}
