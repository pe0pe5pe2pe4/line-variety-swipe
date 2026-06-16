import { NextResponse } from 'next/server';
import { supabase, timed } from '@/lib/supabase';
import { type Content, hasValidThumbnail } from '@/lib/types';
import { inferGenre, resolveGenre } from '@/lib/genre';
import { rateLimit, rateLimited } from '@/lib/rate-limit';
import { isPremiumActive } from '@/lib/premium';
import { captureError, trackApiTiming } from '@/lib/monitoring';

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
// ユーザー嗜好プロファイル（重み付け：ジャンル3 / 放送局2 / キーワード1）
// ───────────────────────────────────────────────
type LikedRow = { title: string; description?: string | null; channel_name?: string | null; content_type?: string | null; genre?: string | null };

type Profile = {
  genreWeights: Record<string, number>;
  stationWeights: Record<string, number>;
  keywordFreq: Record<string, number>;
  dislikedGenres: Record<string, number>; // 左スワイプしたジャンル → 表示頻度を下げる
  topGenre?: string;
  topStation?: string;
  cooldownGenre?: string; // 直近に偏ったジャンル → 一時的に下げる
  timeBoostGenres?: Set<string>; // 時間帯別に優先するジャンル
  cfBoostIds?: Set<string>; // 協調フィルタリングで優先する番組ID
  premium?: boolean; // プレミアム：精度UP・新着優先
};

const W_GENRE = 3;
const W_STATION = 2;
const W_KEYWORD = 1;
const PENALTY_DISLIKED_GENRE = 1.5;

// YouTubeの「知らないけど面白い」ミドル帯（数万〜数十万再生）
const YT_SWEET_MIN = 20_000;
const YT_SWEET_MAX = 800_000;
const YT_SWEET_TARGET = 120_000;

function topKey(weights: Record<string, number>): string | undefined {
  const entries = Object.entries(weights);
  if (entries.length === 0) return undefined;
  return entries.sort(([, a], [, b]) => b - a)[0][0];
}

function buildProfile(liked: LikedRow[], disliked: LikedRow[]): Profile {
  const genreWeights: Record<string, number> = {};
  const stationWeights: Record<string, number> = {};
  for (const c of liked) {
    const g = resolveGenre(c);
    genreWeights[g] = (genreWeights[g] ?? 0) + 1;
    const st = c.channel_name?.trim();
    if (st) stationWeights[st] = (stationWeights[st] ?? 0) + 1;
  }
  const dislikedGenres: Record<string, number> = {};
  for (const c of disliked) {
    const g = resolveGenre(c);
    dislikedGenres[g] = (dislikedGenres[g] ?? 0) + 1;
  }
  return {
    genreWeights,
    stationWeights,
    keywordFreq: buildFreqMap(liked),
    dislikedGenres,
    topGenre: topKey(genreWeights),
    topStation: topKey(stationWeights),
  };
}

function hasPreference(p: Profile): boolean {
  return Object.keys(p.genreWeights).length > 0 || Object.keys(p.keywordFreq).length > 0;
}

/** ジャンル3 / 放送局2 / キーワード1 で重み付けし、嫌いなジャンルは減点 */
function scoreWithProfile(c: Content, p: Profile): number {
  const genre = resolveGenre(c);
  let score = 0;
  score += W_GENRE * (p.genreWeights[genre] ?? 0);
  const st = c.channel_name?.trim();
  if (st) score += W_STATION * (p.stationWeights[st] ?? 0);
  const words = extractKeywords(`${c.title} ${c.description ?? ''}`);
  score += W_KEYWORD * words.reduce((sum, w) => sum + (p.keywordFreq[w] ?? 0), 0);
  // 左スワイプと同ジャンルは頻度を下げる
  score -= PENALTY_DISLIKED_GENRE * (p.dislikedGenres[genre] ?? 0);
  // 直近に偏ったジャンルは強めに下げて別ジャンルを優先させる（バグ2）
  if (p.cooldownGenre && genre === p.cooldownGenre) score -= 5;
  // 時間帯別ブースト（TASK3）
  if (p.timeBoostGenres?.has(genre)) score += 1.5;
  // 協調フィルタリング：似たユーザーが好んだ番組（TASK3）
  if (p.cfBoostIds?.has(c.id)) score += p.premium ? 3 : 2;
  // 鮮度スコア：7日以内は加点 / 30日以上は減点（プレミアムは新着を強めに優先）
  score += freshnessBonus((c as { created_at?: string }).created_at) * (p.premium ? 2 : 1);
  // 品質スコアが高いほど上位に（TASK5）
  score += (typeof c.quality_score === 'number' ? c.quality_score : 0.5) * 3;
  // YouTubeは「数万〜数十万再生」のミドル帯を少し優遇（無名すぎ/有名すぎは控えめ）
  if (c.content_type === 'youtube' && typeof c.yt_view_count === 'number' && c.yt_view_count >= 0) {
    const v = c.yt_view_count;
    if (v >= YT_SWEET_MIN && v <= YT_SWEET_MAX) score += 2;
    else if (v > YT_SWEET_MAX * 6) score -= 1; // 数百万超の有名すぎは少し下げる
  }
  return score;
}

// 新しいコンテンツを優遇し、古いコンテンツの頻度を下げる（最新重視を強化）
function freshnessBonus(createdAt?: string): number {
  if (!createdAt) return 0;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return 0;
  const days = (Date.now() - t) / (24 * 60 * 60 * 1000);
  if (days <= 3) return 4;
  if (days <= 7) return 3;
  if (days <= 30) return 1;
  if (days >= 60) return -1.5;
  return 0;
}

// 新着順に並んだ list を、前方(新しい)を優先しつつ毎回少し変える。
// コールドスタートでも「できるだけ最新かつ可変」な初回フィードにする。
function freshShuffle(list: Content[], count: number): Content[] {
  const n = Math.max(list.length, 1);
  return list
    .map((c, i) => ({ c, key: i * 0.7 + Math.random() * n * 0.5 }))
    .sort((a, b) => a.key - b.key)
    .slice(0, count)
    .map((x) => x.c);
}

// 時間帯別に優先するジャンル（JST基準）
function timeBoostGenresForNow(): Set<string> {
  const jstHour = (new Date().getUTCHours() + 9) % 24;
  if (jstHour >= 6 && jstHour < 11) return new Set(['情報・ワイドショー']);
  if (jstHour >= 11 && jstHour < 15) return new Set(['トーク', 'お笑い・バラエティ']);
  if (jstHour >= 18 && jstHour < 24) return new Set(['お笑い・バラエティ', 'ドッキリ・企画']);
  return new Set();
}

// 協調フィルタリング：自分と同じ番組を好んだユーザーが右スワイプした番組IDを集める
async function collaborativeBoostIds(userId: string, rightSwipeIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (rightSwipeIds.length === 0) return out;
  try {
    // 自分が好きな番組を好きな「似たユーザー」を特定
    const { data: peers } = await supabase
      .from('swipes')
      .select('user_id')
      .eq('direction', 'right')
      .in('content_id', rightSwipeIds.slice(0, 100))
      .neq('user_id', userId)
      .limit(500);
    const overlap = new Map<string, number>();
    for (const p of (peers ?? []) as { user_id: string }[]) {
      overlap.set(p.user_id, (overlap.get(p.user_id) ?? 0) + 1);
    }
    const topUsers = [...overlap.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([u]) => u);
    if (topUsers.length === 0) return out;

    const { data: theirLikes } = await supabase
      .from('swipes')
      .select('content_id')
      .eq('direction', 'right')
      .in('user_id', topUsers)
      .limit(500);
    for (const l of (theirLikes ?? []) as { content_id: string }[]) out.add(l.content_id);
  } catch {
    // 失敗しても致命的ではない
  }
  return out;
}

/** 推薦理由（トップ嗜好に一致する場合のみ付与） */
function reasonFor(c: Content, p: Profile): string | undefined {
  const genre = resolveGenre(c);
  if (p.topGenre && genre === p.topGenre) return `${p.topGenre}が好きそうなので`;
  const st = c.channel_name?.trim();
  if (p.topStation && st === p.topStation) return `${p.topStation}をよく見るので`;
  return undefined;
}

// ───────────────────────────────────────────────
// TV番組取得（Supabase）
// ───────────────────────────────────────────────
async function fetchTVShows(
  swipedIds: string[],
  swipedTitles: Set<string>,
  profile: Profile,
  count: number,
  orFilter = 'content_type.eq.tv_show,content_type.is.null'
): Promise<Content[]> {
  // content_type が tv_show または NULL（未移行データ）を対象（orFilter で切替可）
  // できるだけ最新を出すため新着(created_at)順で候補を取得する。
  let query = supabase
    .from('contents')
    .select('*')
    .or(orFilter)
    .not('thumbnail_url', 'eq', 'no_image')
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(150);

  if (swipedIds.length > 0) {
    query = query.not('id', 'in', `(${swipedIds.join(',')})`);
  }

  const { data } = await query;
  // スワイプ済みタイトル除外 + タイトル重複排除（DBに同じ番組が複数行ある場合の再表示を防ぐ）
  const list = dedupeByTitle((data ?? []) as Content[], swipedTitles);
  if (list.length === 0) return [];

  if (!hasPreference(profile)) {
    // 履歴なし(コールドスタート) → 最新優先＋ランダムで毎回少し変わる初回フィード
    return freshShuffle(list, count);
  }

  // スコアリング + 重み付きシャッフル（ジャンル3/放送局2/キーワード1・嫌いジャンル減点）
  const scores = list.map((c) => scoreWithProfile(c, profile));
  const maxScore = Math.max(...scores, 1);
  return list
    .map((c, i) => ({
      c,
      sortKey: (scores[i] / maxScore) * 0.7 + Math.random() * 0.3,
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

  // 同一チャンネルは最大3件まで（バグ3）
  return capPerChannel(results, 3);
}

// ───────────────────────────────────────────────
// 初期ユーザー向け：DB保存済みYouTube動画を返す（API不使用）
// ───────────────────────────────────────────────
async function fetchStoredYouTubeVideos(
  swipedIds: string[],
  swipedTitles: Set<string>,
  count: number
): Promise<Content[]> {
  // 新着順で取得し、最新を優先（できるだけ最新の動画を初回に出す）
  let query = supabase
    .from('contents')
    .select('*')
    .eq('content_type', 'youtube')
    .not('thumbnail_url', 'eq', 'no_image')
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(count * 8);

  if (swipedIds.length > 0) {
    query = query.not('id', 'in', `(${swipedIds.join(',')})`);
  }

  const { data } = await query;
  const list = dedupeByTitle((data ?? []) as Content[], swipedTitles);
  // 同一チャンネルは最大3件＋最新優先のフレッシュシャッフル
  return capPerChannel(freshShuffle(list, list.length), 3).slice(0, count);
}

// 同一 channel_name のコンテンツを最大 n 件に制限する
function capPerChannel(list: Content[], n: number): Content[] {
  const counts = new Map<string, number>();
  const out: Content[] = [];
  for (const c of list) {
    const ch = (c.channel_name ?? '').trim();
    if (ch) {
      const cur = counts.get(ch) ?? 0;
      if (cur >= n) continue;
      counts.set(ch, cur + 1);
    }
    out.push(c);
  }
  return out;
}

// 再生回数を「32万回再生」形式に整形（フック表示用）
function formatViews(v?: number | null): string | null {
  if (typeof v !== 'number' || v <= 0) return null;
  if (v >= 100_000_000) return `${Math.round(v / 10_000_000) / 10}億回再生`;
  if (v >= 10_000) return `${Math.round(v / 10_000)}万回再生`;
  return `${v.toLocaleString('en-US')}回再生`;
}

// 今週(過去7日)の右スワイプ数で急上昇ランキング（content_id → 順位）。
async function trendingRanking(): Promise<Map<string, number>> {
  const rank = new Map<string, number>();
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('swipes')
      .select('content_id')
      .eq('direction', 'right')
      .gte('created_at', weekAgo);
    const counts = new Map<string, number>();
    for (const s of (data ?? []) as { content_id: string }[]) {
      counts.set(s.content_id, (counts.get(s.content_id) ?? 0) + 1);
    }
    [...counts.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .forEach(([id], i) => rank.set(id, i + 1));
  } catch {
    // 失敗時は空
  }
  return rank;
}

// ジャンル別の YouTube 視聴回数ランキング（各ジャンルの上位3件・content_id → {genre,rank}）。
async function genreViewRanking(): Promise<Map<string, { genre: string; rank: number }>> {
  const out = new Map<string, { genre: string; rank: number }>();
  try {
    const { data } = await supabase
      .from('contents')
      .select('id, title, description, channel_name, content_type, genre, yt_view_count')
      .eq('content_type', 'youtube')
      .gt('yt_view_count', 0)
      .order('yt_view_count', { ascending: false })
      .limit(500);
    const perGenre = new Map<string, string[]>();
    for (const r of (data ?? []) as (Content & { id: string })[]) {
      const g = resolveGenre(r);
      const arr = perGenre.get(g) ?? [];
      if (arr.length < 3) arr.push(r.id);
      perGenre.set(g, arr);
    }
    for (const [genre, ids] of perGenre) {
      ids.forEach((id, i) => out.set(id, { genre, rank: i + 1 }));
    }
  } catch {
    // 失敗時は空
  }
  return out;
}

// 候補集合の「露出量」（全ユーザーのスワイプ回数）を取得する。
// 露出が少ない＝まだ知られていない＝発掘候補。候補IDに絞った軽量クエリ。
async function candidateExposure(ids: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (ids.length === 0) return m;
  try {
    const { data } = await supabase.from('swipes').select('content_id').in('content_id', ids);
    for (const r of (data ?? []) as { content_id: string }[]) {
      m.set(r.content_id, (m.get(r.content_id) ?? 0) + 1);
    }
  } catch {
    // 失敗時は空（全件0=発掘優先度フラットでも動作する）
  }
  return m;
}

// ───────────────────────────────────────────────
// ユーティリティ
// ───────────────────────────────────────────────
function normalizeTitle(title: string): string {
  return (title ?? '').trim().toLowerCase();
}

// 説明文がこの文字数以下の番組はスワイプ候補から除外（品質担保）
const MIN_DESC_LEN = 11;

/**
 * スワイプ済みタイトルを除外しつつ、タイトル重複を1件に集約する。
 * 説明文が短すぎる（10文字以下）番組も品質確保のため除外する。
 * DBに同一番組が複数行存在しても、1度スワイプすれば再表示されなくなる。
 */
function dedupeByTitle(list: Content[], excludeTitles: Set<string>): Content[] {
  const seen = new Set<string>();
  const result: Content[] = [];
  for (const c of list) {
    const key = normalizeTitle(c.title);
    if (!key) continue;
    // 画像が無い/no_image/placehold はスワイプ候補から完全除外（TASK6）
    if (!hasValidThumbnail(c.thumbnail_url)) continue;
    if ((c.description ?? '').trim().length < MIN_DESC_LEN) continue;
    // 品質スコアが低い（0.3未満）コンテンツは表示しない（TASK5）
    if (typeof c.quality_score === 'number' && c.quality_score < 0.3) continue;
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

// 隣接させたくない（同ジャンル or 同チャンネル）か判定
function sameBucket(a: Content, b: Content): boolean {
  if (!a || !b) return false;
  if (resolveGenre(a) === resolveGenre(b)) return true;
  const ca = (a.channel_name ?? '').trim();
  const cb = (b.channel_name ?? '').trim();
  return !!ca && ca === cb;
}

// 同ジャンル/同チャンネルの連続を、後ろの異なる要素と入れ替えて緩和する
function diversify(list: Content[]): Content[] {
  const result = [...list];
  for (let k = 1; k < result.length; k++) {
    if (!sameBucket(result[k - 1], result[k])) continue;
    for (let m = k + 1; m < result.length; m++) {
      const okPrev = !sameBucket(result[k - 1], result[m]);
      const okNext = k + 1 >= result.length || !sameBucket(result[m], result[k + 1]);
      // YouTube2連続を作らない
      const ytSafe =
        result[m].content_type !== 'youtube' ||
        (result[k - 1].content_type !== 'youtube' &&
          (k + 1 >= result.length || result[k + 1].content_type !== 'youtube'));
      if (okPrev && okNext && ytSafe) {
        [result[k], result[m]] = [result[m], result[k]];
        break;
      }
    }
  }
  return result;
}

// ── 種別比率(tv_show40/youtube30/tver30)でラウンドロビン混在し、
//    ジャンル/放送局の連続を抑えて TOTAL 件まで返す（TASK2）──
function station(c: Content): string {
  return (c.channel_name ?? '').trim();
}

function mixDiverse(tvShow: Content[], youtube: Content[], tver: Content[], total: number): Content[] {
  const queues = [
    { items: tvShow, weight: 4, idx: 0, used: 0 },
    { items: youtube, weight: 3, idx: 0, used: 0 },
    { items: tver, weight: 3, idx: 0, used: 0 },
  ];
  const avail = tvShow.length + youtube.length + tver.length;
  const target = Math.min(total, avail);
  const out: Content[] = [];
  while (out.length < target) {
    // 比率に対して最も不足している種別を選ぶ（残りがある中で）
    let best = -1;
    let bestDeficit = -Infinity;
    for (let i = 0; i < queues.length; i++) {
      const q = queues[i];
      if (q.idx >= q.items.length) continue;
      const want = (out.length + 1) * (q.weight / 10);
      const deficit = want - q.used;
      if (deficit > bestDeficit) { bestDeficit = deficit; best = i; }
    }
    if (best < 0) break;
    out.push(queues[best].items[queues[best].idx++]);
    queues[best].used++;
  }
  return diversifyRuns(diversify(out));
}

// 同ジャンル4連続・同放送局3連続を後方の異なる要素と入れ替えて崩す
function diversifyRuns(list: Content[]): Content[] {
  const r = [...list];
  const swapLater = (i: number, ok: (c: Content) => boolean) => {
    for (let m = i + 1; m < r.length; m++) {
      if (ok(r[m])) { [r[i], r[m]] = [r[m], r[i]]; return; }
    }
  };
  for (let i = 0; i < r.length; i++) {
    // ジャンル4連続 → i 番目を別ジャンルに
    if (i >= 3 &&
        resolveGenre(r[i]) === resolveGenre(r[i - 1]) &&
        resolveGenre(r[i - 1]) === resolveGenre(r[i - 2]) &&
        resolveGenre(r[i - 2]) === resolveGenre(r[i - 3])) {
      swapLater(i, (c) => resolveGenre(c) !== resolveGenre(r[i - 1]));
    }
    // 放送局3連続 → i 番目を別放送局に
    if (i >= 2 && station(r[i]) && station(r[i]) === station(r[i - 1]) && station(r[i - 1]) === station(r[i - 2])) {
      swapLater(i, (c) => station(c) !== station(r[i - 1]));
    }
  }
  return r;
}

// 多様性スコア(0-100)：隣接ペアでジャンルが異なる割合
function computeDiversityScore(list: Content[]): number {
  if (list.length < 2) return 100;
  let diff = 0;
  for (let i = 1; i < list.length; i++) {
    if (resolveGenre(list[i]) !== resolveGenre(list[i - 1])) diff++;
  }
  return Math.round((diff / (list.length - 1)) * 100);
}

// ───────────────────────────────────────────────
// 30秒キャッシュ（同一 user_id + exclude のリクエストはDBを叩かず即返す）
// ───────────────────────────────────────────────
type CacheEntry = { at: number; body: Content[]; headers: Record<string, string> };
const RECO_CACHE = new Map<string, CacheEntry>();
const RECO_TTL = 30_000;

function cacheGet(key: string): CacheEntry | null {
  const hit = RECO_CACHE.get(key);
  if (hit && Date.now() - hit.at < RECO_TTL) return hit;
  if (hit) RECO_CACHE.delete(key);
  return null;
}

function cacheSet(key: string, body: Content[], headers: Record<string, string>) {
  // 肥大化防止：古いエントリを掃除
  if (RECO_CACHE.size > 500) {
    const now = Date.now();
    for (const [k, v] of RECO_CACHE) if (now - v.at >= RECO_TTL) RECO_CACHE.delete(k);
  }
  RECO_CACHE.set(key, { at: Date.now(), body, headers });
}

// ───────────────────────────────────────────────
// メインハンドラ
// ───────────────────────────────────────────────
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  // クライアントが既に表示済み（スワイプ反映前）のIDを除外できるようにする
  const excludeParam = searchParams.get('exclude') ?? '';

  // 30秒キャッシュ判定
  const cacheKey = `${userId}|${excludeParam}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return NextResponse.json(cached.body, {
      headers: { ...cached.headers, 'X-Cache': 'HIT' },
    });
  }
  const clientExcludeIds = excludeParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const reqStart = Date.now();
  try {
  // ── STEP 1: スワイプ履歴取得 ──
  const { data: allSwipes } = await timed(
    'recommend.swipes',
    supabase
      .from('swipes')
      .select('content_id, direction, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
  );

  const swipedIdSet = new Set<string>([
    ...(allSwipes ?? []).map((s) => s.content_id as string),
    ...clientExcludeIds,
  ]);
  const swipedIds = [...swipedIdSet];
  const rightSwipes = (allSwipes ?? []).filter((s) => s.direction === 'right');
  const leftSwipes = (allSwipes ?? []).filter((s) => s.direction === 'left');
  const rightSwipeCount = rightSwipes.length;
  const rightSwipeIds = rightSwipes.map((s) => s.content_id as string);
  const leftSwipeIds = leftSwipes.map((s) => s.content_id as string);
  // 直近10件のスワイプ（created_at 降順）
  const recentSwipeIds = (allSwipes ?? []).slice(0, 10).map((s) => s.content_id as string);

  // ── STEP 2: スワイプ済みタイトル & 嗜好プロファイル構築 ──
  // スワイプ済みタイトルを集約し、DBに重複行があっても再表示されないようにする
  const swipedTitles = new Set<string>();
  const idGenre = new Map<string, string>();
  let keywords: string[] = [];
  let profile: Profile = buildProfile([], []);

  if (swipedIds.length > 0) {
    const { data: swipedContents } = await supabase
      .from('contents')
      .select('id, title, description, channel_name, content_type, genre')
      .in('id', swipedIds);
    for (const c of swipedContents ?? []) {
      const key = (c.title ?? '').trim().toLowerCase();
      if (key) swipedTitles.add(key);
      idGenre.set(c.id as string, resolveGenre(c as LikedRow & { id: string }));
    }
  }

  // 直近10件で先頭から同じジャンルが3件以上続いていたら、そのジャンルをクールダウン
  let cooldownGenre: string | undefined;
  if (recentSwipeIds.length >= 3) {
    const first = idGenre.get(recentSwipeIds[0]);
    if (first) {
      let streak = 0;
      for (const id of recentSwipeIds) {
        if (idGenre.get(id) === first) streak++;
        else break;
      }
      if (streak >= 3) cooldownGenre = first;
    }
  }

  // 右スワイプ＝好き / 左スワイプ＝嫌い の詳細を取得してプロファイル化
  const [likedRes, dislikedRes] = await Promise.all([
    rightSwipeIds.length > 0
      ? supabase.from('contents').select('title, description, channel_name, content_type, genre').in('id', rightSwipeIds)
      : Promise.resolve({ data: [] as LikedRow[] }),
    leftSwipeIds.length > 0
      ? supabase.from('contents').select('title, description, channel_name, content_type, genre').in('id', leftSwipeIds)
      : Promise.resolve({ data: [] as LikedRow[] }),
  ]);

  const likedContents = (likedRes.data ?? []) as LikedRow[];
  const dislikedContents = (dislikedRes.data ?? []) as LikedRow[];
  if (likedContents.length > 0 || dislikedContents.length > 0) {
    profile = buildProfile(likedContents, dislikedContents);
    keywords = extractSearchKeywords(likedContents);
  }
  profile.cooldownGenre = cooldownGenre;
  profile.timeBoostGenres = timeBoostGenresForNow();
  profile.cfBoostIds = await collaborativeBoostIds(userId, rightSwipeIds);
  // プレミアム判定（精度UP・新着優先）。列が無くても落ちないよう try/catch。
  try {
    const { data: u } = await supabase
      .from('users')
      .select('is_premium, premium_until')
      .eq('line_user_id', userId)
      .maybeSingle();
    profile.premium = isPremiumActive(u as { is_premium?: boolean | null; premium_until?: string | null } | null);
  } catch {
    profile.premium = false;
  }

  // ── STEP 3: 種別比率 tv_show 40% / youtube 30% / tver 30%（TASK2）──
  const TOTAL = 30;
  const tvShowCount = Math.round(TOTAL * 0.4);
  const ytCount = Math.round(TOTAL * 0.3);
  const tverCount = TOTAL - tvShowCount - ytCount;

  // ── STEP 4: 種別ごとに並列取得（発掘枠用に多めの候補プールを確保）──
  const POOL = TOTAL + 25; // 上位だけでなく裾野(=埋もれた候補)も取り込む
  const [tvShows, tverShows, ytVideos] = await timed(
    'recommend.fetchContents',
    Promise.all([
      fetchTVShows(swipedIds, swipedTitles, profile, POOL, 'content_type.eq.tv_show,content_type.is.null'),
      fetchTVShows(swipedIds, swipedTitles, profile, POOL, 'content_type.eq.tver'),
      rightSwipeCount < 10
        ? fetchStoredYouTubeVideos(swipedIds, swipedTitles, ytCount + 15)
        : fetchYouTubeVideos(keywords, swipedIds, swipedTitles, ytCount + 15),
    ])
  );

  // ── STEP 5: 「あなた向け」70% ＋「発掘枠」30% を混ぜて返す ──
  void tvShowCount; void tverCount; // 比率は mixDiverse の重みで表現
  const gemCount = Math.round(TOTAL * 0.3);
  const mainCount = TOTAL - gemCount;

  // あなた向け（嗜好順）
  const forYou = mixDiverse(tvShows, ytVideos, tverShows, mainCount);

  // 発掘枠：「露出が少ない＝まだ知られていない」候補を優先しつつ、
  // 当たり学習＝過去に好きだったチャンネル(無名含む)の別動画を最優先に引き上げる。
  const candAll = [...tvShows, ...tverShows, ...ytVideos];
  const exposure = await candidateExposure(candAll.map((c) => c.id));
  const usedIds = new Set(forYou.map((c) => c.id));
  const likedChannels = new Set(Object.keys(profile.stationWeights));
  // YouTube は「数万〜数十万再生」のミドル帯を発掘の本命にする（無名すぎ/有名すぎを避ける）
  const inSweetBand = (c: Content): boolean => {
    if (c.content_type !== 'youtube') return false;
    const v = c.yt_view_count;
    if (typeof v !== 'number' || v < 0) return false; // 未取得/取得不可
    return v >= YT_SWEET_MIN && v <= YT_SWEET_MAX;
  };
  const gemRank = (c: Content): number => {
    const ch = (c.channel_name ?? '').trim();
    if (ch && likedChannels.has(ch)) return 0;       // 好きなチャンネルの別動画（当たり学習）
    if (inSweetBand(c)) return 1;                     // 数万〜数十万の「知らないけど面白い」帯
    if (!profile.topGenre || resolveGenre(c) !== profile.topGenre) return 2; // 別ジャンルのセレンディピティ
    return 3;
  };
  // ミドル帯の中心(目標再生数)に近いほど良い。帯外/未知は最後。
  const bandScore = (c: Content): number => {
    const v = c.yt_view_count;
    if (typeof v !== 'number' || v < 0) return Number.MAX_SAFE_INTEGER;
    return Math.abs(v - YT_SWEET_TARGET);
  };
  const gemPool = candAll
    .filter((c) => !usedIds.has(c.id))
    .sort((a, b) => {
      const r = gemRank(a) - gemRank(b);
      if (r !== 0) return r;
      // 同ランク内は「目標再生数に近い→露出が少ない」順
      const bs = bandScore(a) - bandScore(b);
      if (bs !== 0) return bs;
      return (exposure.get(a.id) ?? 0) - (exposure.get(b.id) ?? 0);
    });
  const gems = capPerChannel(gemPool, 2).slice(0, gemCount);
  const gemIds = new Set(gems.map((c) => c.id));

  // 発掘枠を3枠に1回の頻度で差し込み、ジャンル/放送局の連続を抑える
  const woven: Content[] = [];
  let mi = 0;
  let gi = 0;
  for (let i = 0; woven.length < TOTAL && (mi < forYou.length || gi < gems.length); i++) {
    if (i % 3 === 2 && gi < gems.length) woven.push(gems[gi++]);
    else if (mi < forYou.length) woven.push(forYou[mi++]);
    else if (gi < gems.length) woven.push(gems[gi++]);
  }
  const ordered = diversify(woven);

  // ── フック表示：再生回数・今週の急上昇ランキング・カテゴリ別視聴順位 ──
  const [trendingRank, genreViewRank] = await Promise.all([
    trendingRanking(),
    genreViewRanking(),
  ]);
  const result = ordered.map((c) => {
    const tr = trendingRank.get(c.id);
    const gvr = genreViewRank.get(c.id);
    let rankBadge: string | null = null;
    if (tr) rankBadge = `🔥 今週の急上昇 #${tr}`;
    else if (gvr) {
      const medal = gvr.rank === 1 ? '🥇' : gvr.rank === 2 ? '🥈' : '🥉';
      rankBadge = `${medal} ${gvr.genre} 視聴${gvr.rank}位`;
    }
    return {
      ...c,
      genre: resolveGenre(c),
      discovery: gemIds.has(c.id),
      recommend_reason: gemIds.has(c.id) ? '🔍 まだ知られていない発掘枠' : reasonFor(c, profile),
      rank_badge: rankBadge,
      views_label: formatViews(c.yt_view_count),
    };
  });
  const diversityScore = computeDiversityScore(result);
  const discoveryCount = result.filter((c) => c.discovery).length;

  // まだスワイプしていない番組の総数（概算）
  const { count: totalContents } = await supabase
    .from('contents')
    .select('id', { count: 'exact', head: true })
    .not('thumbnail_url', 'eq', 'no_image');
  const totalAvailable = Math.max(0, (totalContents ?? 0) - swipedIds.length);
  // パーソナライズ度合い（0-100）：右スワイプ数に応じて上昇
  const personalizationScore = Math.min(100, Math.round((rightSwipeCount / 20) * 100));

  const typeCount = (t: string) => result.filter((c) => (c.content_type ?? 'tv_show') === t).length;
  const headers: Record<string, string> = {
    'X-Mix-Ratio': `tv=${typeCount('tv_show')}/yt=${typeCount('youtube')}/tver=${typeCount('tver')}`,
    'X-Right-Swipes': String(rightSwipeCount),
    'X-Top-Genre': profile.topGenre ?? '',
    'X-Keywords': keywords.slice(0, 5).join(','),
    'X-Total-Available': String(totalAvailable),
    'X-Personalization-Score': String(personalizationScore),
    'X-Diversity-Score': String(diversityScore),
    'X-Discovery-Count': String(discoveryCount),
    'Cache-Control': 'private, max-age=30',
  };
  cacheSet(cacheKey, result, headers);

  trackApiTiming('recommend', Date.now() - reqStart);
  return NextResponse.json(result, { headers: { ...headers, 'X-Cache': 'MISS' } });
  } catch (e) {
    captureError(e, { api: 'recommend' });
    return NextResponse.json(
      { error: 'recommend failed', detail: String(e) },
      { status: 500 }
    );
  }
}
