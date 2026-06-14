import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import type { Content } from '@/lib/types';

// ───────────────────────────────────────────────
// キーワード抽出ユーティリティ
// ───────────────────────────────────────────────
const STOP_WORDS = new Set([
  'の','は','が','を','に','で','と','も','な','た','て','い','る','し',
  'こ','そ','あ','さ','れ','か','う','よ','ん','だ','や','ら','ま','す',
  'せ','く','ない','から','まで','より','など','ため','こと','もの',
  'テレビ','番組','放送','公式','チャンネル',
]);

function extractKeywords(text: string): string[] {
  return text
    .split(/[\s　、。・！？「」『』【】\n\r]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function buildFreqMap(
  contents: { title: string; description?: string | null }[]
): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const c of contents) {
    const words = extractKeywords(`${c.title} ${c.description ?? ''}`);
    for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
  }
  return freq;
}

function scoreContent(
  c: { title: string; description?: string | null },
  freq: Record<string, number>
): number {
  const words = extractKeywords(`${c.title} ${c.description ?? ''}`);
  return words.reduce((sum, w) => sum + (freq[w] ?? 0), 0);
}

/** 右スワイプしたコンテンツからYouTube検索クエリ用キーワードを抽出 */
function extractSearchKeywords(
  contents: { title: string; channel_name?: string | null }[]
): string[] {
  const freq: Record<string, number> = {};
  for (const c of contents) {
    for (const w of extractKeywords(c.title)) freq[w] = (freq[w] ?? 0) + 1;
    if (c.channel_name) freq[c.channel_name] = (freq[c.channel_name] ?? 0) + 2;
  }
  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k)
    .slice(0, 8);
}

// ───────────────────────────────────────────────
// TV番組取得（Supabase）
// ───────────────────────────────────────────────
async function fetchTVShows(
  swipedIds: string[],
  swipedTitles: Set<string>,
  freqMap: Record<string, number>,
  count: number
): Promise<Content[]> {
  // content_type が tv_show または NULL（未移行データ）を対象
  // youtube系は source が youtube_recommend / youtube_search / youtuber / comedian / tv_official
  let query = supabase
    .from('contents')
    .select('*')
    .or('content_type.eq.tv_show,content_type.is.null')
    .not('thumbnail_url', 'eq', 'no_image')
    .order('description', { ascending: false, nullsFirst: false })
    .limit(120);

  if (swipedIds.length > 0) {
    query = query.not('id', 'in', `(${swipedIds.join(',')})`);
  }

  const { data } = await query;
  // スワイプ済みタイトル除外 + タイトル重複排除（DBに同じ番組が複数行ある場合の再表示を防ぐ）
  const list = dedupeByTitle((data ?? []) as Content[], swipedTitles);
  if (list.length === 0) return [];

  if (Object.keys(freqMap).length === 0) {
    // スワイプ履歴なし → ランダム
    return shuffle(list).slice(0, count);
  }

  // スコアリング + 重み付きシャッフル
  const maxScore = Math.max(...list.map((c) => scoreContent(c, freqMap)), 1);
  return list
    .map((c) => ({
      c,
      sortKey: (scoreContent(c, freqMap) / maxScore) * 0.7 + Math.random() * 0.3,
    }))
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, count)
    .map(({ c }) => c);
}

// ───────────────────────────────────────────────
// YouTube動画取得（API検索 → DBキャッシュ）
// ───────────────────────────────────────────────
type RawYTItem = {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  channelTitle: string;
  youtubeUrl: string;
};

async function searchYouTubeAPI(query: string, maxResults: number): Promise<RawYTItem[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    order: 'relevance',
    maxResults: String(maxResults),
    regionCode: 'JP',
    relevanceLanguage: 'ja',
    key: apiKey,
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (data.error) return [];

  return (data.items ?? [])
    .map((item: Record<string, unknown>) => {
      const id = item.id as Record<string, string>;
      const snippet = item.snippet as Record<string, unknown>;
      const thumbnails = snippet?.thumbnails as Record<string, {url: string}> | undefined;
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
          thumbnails?.default?.url ??
          '',
        channelTitle: String(snippet?.channelTitle ?? ''),
        youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      };
    })
    .filter(Boolean) as RawYTItem[];
}

async function fetchYouTubeVideos(
  keywords: string[],
  swipedIds: string[],
  swipedTitles: Set<string>,
  count: number
): Promise<Content[]> {
  if (!process.env.YOUTUBE_API_KEY) return [];

  const query =
    keywords.length > 0
      ? keywords.slice(0, 3).join(' ') + ' バラエティ'
      : 'バラエティ 人気 日本 お笑い';

  let rawItems: RawYTItem[] = [];
  try {
    rawItems = await searchYouTubeAPI(query, count * 2);
  } catch {
    return [];
  }
  if (rawItems.length === 0) return [];

  // ── バッチでDB確認（既存キャッシュを再利用）──
  const urls = rawItems.map((v) => v.youtubeUrl);
  let existingMap = new Map<string, string>(); // youtube_url → content.id

  try {
    const { data: existingRows } = await supabase
      .from('contents')
      .select('id, youtube_url')
      .in('youtube_url', urls);

    for (const row of existingRows ?? []) {
      existingMap.set(row.youtube_url, row.id);
    }

    // 新規のみ一括 insert
    const toInsert = rawItems.filter((v) => !existingMap.has(v.youtubeUrl));
    if (toInsert.length > 0) {
      const { data: inserted } = await supabase
        .from('contents')
        .insert(
          toInsert.map((v) => ({
            title: v.title,
            description: v.description,
            thumbnail_url: v.thumbnailUrl,
            youtube_url: v.youtubeUrl,
            channel_name: v.channelTitle,
            content_type: 'youtube',
            source: 'youtube_recommend',
            vod_affiliate_url: '',
          }))
        )
        .select('id, youtube_url');

      for (const row of inserted ?? []) {
        existingMap.set(row.youtube_url, row.id);
      }
    }
  } catch {
    // youtube_url カラムが未作成の場合はスキップ（DBマイグレーション未実施）
    return [];
  }

  // ── スワイプ済み除外・タイトル重複排除・Content型に変換 ──
  const swipedSet = new Set(swipedIds);
  const seenTitles = new Set<string>();
  const results: Content[] = [];

  for (const v of rawItems) {
    if (results.length >= count) break;
    const id = existingMap.get(v.youtubeUrl);
    if (!id || swipedSet.has(id)) continue;
    const titleKey = normalizeTitle(v.title);
    if (swipedTitles.has(titleKey) || seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);

    results.push({
      id,
      title: v.title,
      description: v.description,
      thumbnail_url: v.thumbnailUrl,
      vod_affiliate_url: '',
      content_type: 'youtube',
      youtube_url: v.youtubeUrl,
      channel_name: v.channelTitle,
    });
  }

  return results;
}

// ───────────────────────────────────────────────
// 初期ユーザー向け：DB保存済みYouTube動画を返す（API不使用）
// ───────────────────────────────────────────────
async function fetchStoredYouTubeVideos(
  swipedIds: string[],
  swipedTitles: Set<string>,
  count: number
): Promise<Content[]> {
  let query = supabase
    .from('contents')
    .select('*')
    .eq('content_type', 'youtube')
    .not('thumbnail_url', 'eq', 'no_image')
    .limit(count * 5);

  if (swipedIds.length > 0) {
    query = query.not('id', 'in', `(${swipedIds.join(',')})`);
  }

  const { data } = await query;
  const list = dedupeByTitle((data ?? []) as Content[], swipedTitles);
  return shuffle(list).slice(0, count);
}

// ───────────────────────────────────────────────
// ユーティリティ
// ───────────────────────────────────────────────
function normalizeTitle(title: string): string {
  return (title ?? '').trim().toLowerCase();
}

/**
 * スワイプ済みタイトルを除外しつつ、タイトル重複を1件に集約する。
 * DBに同一番組が複数行存在しても、1度スワイプすれば再表示されなくなる。
 */
function dedupeByTitle(list: Content[], excludeTitles: Set<string>): Content[] {
  const seen = new Set<string>();
  const result: Content[] = [];
  for (const c of list) {
    const key = normalizeTitle(c.title);
    if (!key) continue;
    if (excludeTitles.has(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * TV番組とYouTube動画を指定比率で混在させる。
 * ランダムな位置に YouTube を挿入して返す。
 */
function mixContent(tvShows: Content[], ytVideos: Content[]): Content[] {
  if (ytVideos.length === 0) return tvShows;
  if (tvShows.length === 0) return ytVideos;

  const total = tvShows.length + ytVideos.length;
  const ytPositions = new Set<number>();

  // YouTube の挿入位置をランダムに決定
  const positions = shuffle([...Array(total).keys()]);
  for (let i = 0; i < ytVideos.length && i < positions.length; i++) {
    ytPositions.add(positions[i]);
  }

  const result: Content[] = new Array(total);
  let tvIdx = 0, ytIdx = 0;
  for (let i = 0; i < total; i++) {
    if (ytPositions.has(i) && ytIdx < ytVideos.length) {
      result[i] = ytVideos[ytIdx++];
    } else if (tvIdx < tvShows.length) {
      result[i] = tvShows[tvIdx++];
    } else {
      result[i] = ytVideos[ytIdx++];
    }
  }
  return result;
}

// ───────────────────────────────────────────────
// メインハンドラ
// ───────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  // クライアントが既に表示済み（スワイプ反映前）のIDを除外できるようにする
  const excludeParam = searchParams.get('exclude') ?? '';
  const clientExcludeIds = excludeParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // ── STEP 1: スワイプ履歴取得 ──
  const { data: allSwipes } = await supabase
    .from('swipes')
    .select('content_id, direction')
    .eq('user_id', userId);

  const swipedIdSet = new Set<string>([
    ...(allSwipes ?? []).map((s) => s.content_id as string),
    ...clientExcludeIds,
  ]);
  const swipedIds = [...swipedIdSet];
  const rightSwipes = (allSwipes ?? []).filter((s) => s.direction === 'right');
  const rightSwipeCount = rightSwipes.length;
  const rightSwipeIds = rightSwipes.map((s) => s.content_id as string);

  // ── STEP 2: スワイプ済みタイトル & 右スワイプ履歴からキーワード抽出 ──
  // スワイプ済みタイトルを集約し、DBに重複行があっても再表示されないようにする
  const swipedTitles = new Set<string>();
  let keywords: string[] = [];
  let freqMap: Record<string, number> = {};

  if (swipedIds.length > 0) {
    const { data: swipedContents } = await supabase
      .from('contents')
      .select('id, title')
      .in('id', swipedIds);
    for (const c of swipedContents ?? []) {
      const key = (c.title ?? '').trim().toLowerCase();
      if (key) swipedTitles.add(key);
    }
  }

  if (rightSwipeIds.length > 0) {
    const { data: likedContents } = await supabase
      .from('contents')
      .select('title, description, channel_name')
      .in('id', rightSwipeIds);

    if (likedContents?.length) {
      keywords = extractSearchKeywords(likedContents);
      freqMap = buildFreqMap(likedContents);
    }
  }

  // ── STEP 3: 混在比率を決定（2段階パーソナライズ）──
  let tvRatio: number;
  if (rightSwipeCount < 10) {
    tvRatio = 0.7; // 0-9件: tv 70% / youtube 30%（固定コンテンツ・API不使用）
  } else if (rightSwipeCount < 30) {
    tvRatio = 0.5; // 10-29件: tv 50% / youtube 50%（動的キーワード検索）
  } else {
    tvRatio = 0.3; // 30+件: tv 30% / youtube 70%（フル最適化）
  }

  // 1コールあたりの返却数を増やし、20回で止まる問題を解消（残り少で追加取得＝無限スワイプ）
  const TOTAL = 20;
  const tvCount = Math.round(TOTAL * tvRatio);
  const ytCount = TOTAL - tvCount;

  // ── STEP 4: 全ソースから並列取得 ──
  // 0-9スワイプ：DBのキャッシュ済みYouTube（API呼び出しなし）
  // 10+スワイプ：リアルタイムYouTube API検索
  const [tvShows, ytVideos] = await Promise.all([
    fetchTVShows(swipedIds, swipedTitles, freqMap, tvCount + ytCount),
    rightSwipeCount < 10
      ? fetchStoredYouTubeVideos(swipedIds, swipedTitles, ytCount)
      : fetchYouTubeVideos(keywords, swipedIds, swipedTitles, ytCount),
  ]);

  // YouTube が足りない場合は TV で補完
  const actualYtCount = ytVideos.length;
  const finalTvCount = tvCount + (ytCount - actualYtCount);
  const finalTvShows = tvShows.slice(0, finalTvCount);

  // ── STEP 5: 混在・返却 ──
  const result = mixContent(finalTvShows, ytVideos);

  return NextResponse.json(result, {
    headers: {
      'X-Mix-Ratio': `tv=${finalTvShows.length}/yt=${actualYtCount}`,
      'X-Right-Swipes': String(rightSwipeCount),
      'X-Keywords': keywords.slice(0, 5).join(','),
    },
  });
}
