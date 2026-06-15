import { NextResponse } from 'next/server';
import { supabase, timed } from '@/lib/supabase';
import { type Content, hasValidThumbnail } from '@/lib/types';
import { inferGenre, resolveGenre } from '@/lib/genre';
import { rateLimit, rateLimited } from '@/lib/rate-limit';
import { isPremiumActive } from '@/lib/premium';

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
  return score;
}

// 新しいコンテンツを優遇し、古いコンテンツの頻度を下げる
function freshnessBonus(createdAt?: string): number {
  if (!createdAt) return 0;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return 0;
  const days = (Date.now() - t) / (24 * 60 * 60 * 1000);
  if (days <= 7) return 2;
  if (days >= 30) return -1;
  return 0;
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
  count: number
): Promise<Content[]> {
  // content_type が tv_show または NULL（未移行データ）を対象
  // youtube系は source が youtube_recommend / youtube_search / youtuber / comedian / tv_official
  let query = supabase
    .from('contents')
    .select('*')
    .or('content_type.eq.tv_show,content_type.eq.tver,content_type.is.null')
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

  if (!hasPreference(profile)) {
    // スワイプ履歴なし → ランダム
    return shuffle(list).slice(0, count);
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
  // 同一チャンネルは1セッション最大3件まで（バグ3）
  return capPerChannel(shuffle(list), 3).slice(0, count);
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

/**
 * TV/Tver と YouTube を多様性を保ちつつ混在させる（バグ2・3）。
 * - YouTube は3枠に1回（index%3===2）、2連続にしない
 * - 同ジャンル・同チャンネルが連続しないよう並べ替える
 */
function mixContent(tvShows: Content[], ytVideos: Content[]): Content[] {
  if (ytVideos.length === 0) return diversify(tvShows);
  if (tvShows.length === 0) return ytVideos; // youtube は capPerChannel 済み

  const result: Content[] = [];
  let ti = 0, yi = 0, i = 0;
  while (ti < tvShows.length || yi < ytVideos.length) {
    const prevIsYt = result[result.length - 1]?.content_type === 'youtube';
    const wantYt = i % 3 === 2 && yi < ytVideos.length && !prevIsYt;
    if (wantYt) {
      result.push(ytVideos[yi++]);
    } else if (ti < tvShows.length) {
      result.push(tvShows[ti++]);
    } else if (yi < ytVideos.length && !prevIsYt) {
      result.push(ytVideos[yi++]);
    } else {
      break;
    }
    i++;
  }
  return diversify(result);
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
  const TOTAL = 30;
  const tvCount = Math.round(TOTAL * tvRatio);
  const ytCount = TOTAL - tvCount;

  // ── STEP 4: 全ソースから並列取得 ──
  // 0-9スワイプ：DBのキャッシュ済みYouTube（API呼び出しなし）
  // 10+スワイプ：リアルタイムYouTube API検索
  const [tvShows, ytVideos] = await timed(
    'recommend.fetchContents',
    Promise.all([
      fetchTVShows(swipedIds, swipedTitles, profile, tvCount + ytCount),
      rightSwipeCount < 10
        ? fetchStoredYouTubeVideos(swipedIds, swipedTitles, ytCount)
        : fetchYouTubeVideos(keywords, swipedIds, swipedTitles, ytCount),
    ])
  );

  // YouTube が足りない場合は TV で補完
  const actualYtCount = ytVideos.length;
  const finalTvCount = tvCount + (ytCount - actualYtCount);
  const finalTvShows = tvShows.slice(0, finalTvCount);

  // ── STEP 5: 混在・ジャンル/推薦理由を付与して返却 ──
  const mixed = mixContent(finalTvShows, ytVideos);
  const result = mixed.map((c) => ({
    ...c,
    genre: resolveGenre(c),
    recommend_reason: reasonFor(c, profile),
  }));

  // まだスワイプしていない番組の総数（概算）
  const { count: totalContents } = await supabase
    .from('contents')
    .select('id', { count: 'exact', head: true })
    .not('thumbnail_url', 'eq', 'no_image');
  const totalAvailable = Math.max(0, (totalContents ?? 0) - swipedIds.length);
  // パーソナライズ度合い（0-100）：右スワイプ数に応じて上昇
  const personalizationScore = Math.min(100, Math.round((rightSwipeCount / 20) * 100));

  const headers: Record<string, string> = {
    'X-Mix-Ratio': `tv=${finalTvShows.length}/yt=${actualYtCount}`,
    'X-Right-Swipes': String(rightSwipeCount),
    'X-Top-Genre': profile.topGenre ?? '',
    'X-Keywords': keywords.slice(0, 5).join(','),
    'X-Total-Available': String(totalAvailable),
    'X-Personalization-Score': String(personalizationScore),
    'Cache-Control': 'private, max-age=30',
  };
  cacheSet(cacheKey, result, headers);

  console.log(`[recommend] total ${Date.now() - reqStart}ms (items=${result.length})`);
  return NextResponse.json(result, { headers: { ...headers, 'X-Cache': 'MISS' } });
  } catch (e) {
    return NextResponse.json(
      { error: 'recommend failed', detail: String(e) },
      { status: 500 }
    );
  }
}
