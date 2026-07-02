import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { inferGenre } from '@/lib/genre';
import { DISCOVERY_CHANNELS } from '@/lib/youtube-channels';

export const maxDuration = 25;

// 発掘ハンター：「登録者は少ないのに再生されている＝面白さが数字で証明された無名」を
// YouTube検索から能動的に狩ってDBに入れる。
// 既存ingestとの違い＝入口で選別する。3段フィルタを全部通過した動画だけ insert する:
//   ① キーワード検索（地下芸人/深夜番組/インディーズ等）
//   ② 再生数がミドル帯（2万〜80万）
//   ③ 登録者20万人以下 かつ 再生数が登録者の3倍以上
// ?queries=1..5（既定3・1クエリ=search100ユニット）/ ?batch でクエリ回転（省略時は日替わり）
// 認証は CRON_SECRET。
const YT_API = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 7000;
const DEADLINE_MS = 22000;

// recommend側の発掘基準と揃える
const SWEET_MIN = 20_000;
const SWEET_MAX = 800_000;
const MAX_SUBS = 200_000;
const MIN_RATIO = 3;

// DISCOVERY_CHANNELS のキーワードに、ハンター専用の狙い撃ちクエリを足したプール
const HUNT_QUERIES: string[] = [
  ...DISCOVERY_CHANNELS.map((c) => c.videoQuery).filter((q): q is string => !!q),
  '賞レース 準決勝 ネタ',
  'お笑いライブ 単独公演',
  '芸人 ラジオ 企画',
  '大学生 お笑い サークル ネタ',
  '街ロケ 企画 バラエティ',
  'コント 自主制作',
];

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

type Candidate = {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  channelId: string;
  channelTitle: string;
  views: number;
  subs: number;
};

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const perRun = Math.max(1, Math.min(5, parseInt(searchParams.get('queries') ?? '3', 10) || 3));
  // batch 指定が無ければ日替わりでクエリを回転（毎日違う鉱脈を掘る）
  const dayIndex = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const batch = parseInt(searchParams.get('batch') ?? String(dayIndex % HUNT_QUERIES.length), 10) || 0;
  const queries: string[] = [];
  for (let i = 0; i < perRun; i++) queries.push(HUNT_QUERIES[(batch + i) % HUNT_QUERIES.length]);

  // 直近2年に絞る（古すぎる発掘は「今見つけた」感が薄い）
  const publishedAfter = new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString();

  const started = Date.now();
  const report: { query: string; searched: number; inBand: number; passed: number; inserted: number }[] = [];
  let totalInserted = 0;

  for (const q of queries) {
    if (Date.now() - started > DEADLINE_MS) break;
    const entry = { query: q, searched: 0, inBand: 0, passed: 0, inserted: 0 };
    report.push(entry);

    // ① キーワード検索
    const sParams = new URLSearchParams({
      part: 'snippet',
      q,
      type: 'video',
      order: 'relevance',
      maxResults: '25',
      regionCode: 'JP',
      relevanceLanguage: 'ja',
      publishedAfter,
      key: apiKey,
    });
    const sRes = await ytFetch(`${YT_API}/search?${sParams}`);
    if (!sRes || !sRes.ok) continue;
    const sJson = await sRes.json();
    const base = ((sJson.items ?? []) as Record<string, unknown>[])
      .map((item) => {
        const id = item.id as Record<string, string> | undefined;
        const sn = item.snippet as Record<string, unknown> | undefined;
        const th = sn?.thumbnails as Record<string, { url: string }> | undefined;
        const videoId = id?.videoId ?? '';
        if (!videoId) return null;
        return {
          videoId,
          title: String(sn?.title ?? ''),
          description: String(sn?.description ?? '').slice(0, 500),
          thumbnailUrl: th?.high?.url ?? th?.medium?.url ?? th?.default?.url ?? '',
          channelId: String(sn?.channelId ?? ''),
          channelTitle: String(sn?.channelTitle ?? ''),
        };
      })
      .filter(Boolean) as Omit<Candidate, 'views' | 'subs'>[];
    entry.searched = base.length;
    if (base.length === 0) continue;

    // ② 再生数ミドル帯フィルタ
    const vParams = new URLSearchParams({
      part: 'statistics',
      id: base.map((b) => b.videoId).join(','),
      key: apiKey,
    });
    const vRes = await ytFetch(`${YT_API}/videos?${vParams}`);
    if (!vRes || !vRes.ok) continue;
    const vJson = await vRes.json();
    const viewsById = new Map<string, number>();
    for (const it of (vJson.items ?? []) as { id: string; statistics?: { viewCount?: string } }[]) {
      viewsById.set(it.id, Number(it.statistics?.viewCount ?? 0) || 0);
    }
    const inBand = base
      .map((b) => ({ ...b, views: viewsById.get(b.videoId) ?? 0, subs: 0 }))
      .filter((c) => c.views >= SWEET_MIN && c.views <= SWEET_MAX) as Candidate[];
    entry.inBand = inBand.length;
    if (inBand.length === 0) continue;

    // ③ 登録者比フィルタ（無名 × 実力の証明）
    const channelIds = [...new Set(inBand.map((c) => c.channelId).filter(Boolean))];
    const subsByChannel = new Map<string, number>();
    if (channelIds.length > 0) {
      const cParams = new URLSearchParams({ part: 'statistics', id: channelIds.join(','), key: apiKey });
      const cRes = await ytFetch(`${YT_API}/channels?${cParams}`);
      if (cRes && cRes.ok) {
        const cJson = await cRes.json();
        for (const ch of (cJson.items ?? []) as {
          id: string;
          statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
        }[]) {
          const subs = ch.statistics?.hiddenSubscriberCount
            ? -1
            : Number(ch.statistics?.subscriberCount ?? 0) || 0;
          subsByChannel.set(ch.id, subs);
        }
      }
    }
    const passed = inBand
      .map((c) => ({ ...c, subs: subsByChannel.get(c.channelId) ?? -1 }))
      .filter((c) => c.subs > 0 && c.subs <= MAX_SUBS && c.views / c.subs >= MIN_RATIO);
    entry.passed = passed.length;
    if (passed.length === 0) continue;

    // 既存重複を除いて insert（統計は取得済みなので backfill 不要のまま推薦に乗る）
    const urls = passed.map((c) => `https://www.youtube.com/watch?v=${c.videoId}`);
    const { data: existing } = await supabase.from('contents').select('youtube_url').in('youtube_url', urls);
    const existingUrls = new Set((existing ?? []).map((r) => r.youtube_url));

    for (const c of passed) {
      const url = `https://www.youtube.com/watch?v=${c.videoId}`;
      if (existingUrls.has(url)) continue;
      const row: Record<string, unknown> = {
        title: c.title,
        description: c.description,
        thumbnail_url: c.thumbnailUrl || 'no_image',
        youtube_url: url,
        channel_name: c.channelTitle,
        content_type: 'youtube',
        source: 'gem_hunt',
        genre: inferGenre(c),
        vod_affiliate_url: '',
        yt_view_count: c.views,
        yt_subscriber_count: c.subs,
      };
      let { error } = await supabase.from('contents').insert(row);
      if (error) {
        // yt_subscriber_count 列が未作成のDBでは統計列を抜いて再試行
        const { yt_view_count: _v, yt_subscriber_count: _s, ...rest } = row;
        void _v; void _s;
        ({ error } = await supabase.from('contents').insert(rest));
      }
      if (!error) {
        entry.inserted++;
        totalInserted++;
      }
    }
  }

  return NextResponse.json({ inserted: totalInserted, queries: report });
}
