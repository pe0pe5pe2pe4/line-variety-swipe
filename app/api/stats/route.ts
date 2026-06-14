import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveGenre } from '@/lib/genre';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

type SwipeRow = { content_id: string; direction: string; created_at: string | null };
type ContentRow = {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_name?: string | null;
  content_type?: string | null;
  description?: string | null;
  genre?: string | null;
};

// マイページ統計：総スワイプ数 / 好きな番組TOP5 / ジャンル・放送局ランキング / 今週のスワイプ数
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }

  const { data: swipes, error } = await supabase
    .from('swipes')
    .select('content_id, direction, created_at')
    .eq('user_id', userId);

  if (error) return NextResponse.json({ error }, { status: 500 });

  const all = (swipes ?? []) as SwipeRow[];
  const totalSwipes = all.length;

  // 今週（過去7日）にスワイプした番組数（重複コンテンツは1件に集約）
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const weekSet = new Set<string>();
  for (const s of all) {
    if (s.created_at && new Date(s.created_at).getTime() >= weekAgo) {
      weekSet.add(s.content_id);
    }
  }
  const thisWeekCount = weekSet.size;

  // 右スワイプ回数を番組ごとに集計
  const rightCounts = new Map<string, number>();
  for (const s of all) {
    if (s.direction === 'right') {
      rightCounts.set(s.content_id, (rightCounts.get(s.content_id) ?? 0) + 1);
    }
  }
  const likedIds = [...rightCounts.keys()];

  let topPrograms: unknown[] = [];
  let genreRanking: { name: string; count: number }[] = [];
  let stationRanking: { name: string; count: number }[] = [];

  if (likedIds.length > 0) {
    const { data: contents } = await supabase
      .from('contents')
      .select('id, title, thumbnail_url, channel_name, content_type, description, genre')
      .in('id', likedIds);

    const cmap = new Map(
      ((contents ?? []) as ContentRow[]).map((c) => [c.id, c])
    );

    // 好きな番組TOP5（右スワイプ数が多い順）
    topPrograms = [...rightCounts.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([id, count]) => {
        const c = cmap.get(id);
        if (!c) return null;
        return {
          id,
          title: c.title,
          thumbnail_url: c.thumbnail_url,
          channel_name: c.channel_name ?? null,
          content_type: c.content_type ?? null,
          count,
        };
      })
      .filter(Boolean);

    // ジャンル / 放送局ランキング（右スワイプ数で重み付け）
    const genreCount: Record<string, number> = {};
    const stationCount: Record<string, number> = {};
    for (const [id, count] of rightCounts) {
      const c = cmap.get(id);
      if (!c) continue;
      const g = resolveGenre(c);
      genreCount[g] = (genreCount[g] ?? 0) + count;
      const st = c.channel_name?.trim();
      if (st) stationCount[st] = (stationCount[st] ?? 0) + count;
    }
    genreRanking = Object.entries(genreCount)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({ name, count }));
    stationRanking = Object.entries(stationCount)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({ name, count }));
  }

  // ── 今週最も右スワイプされた番組 TOP5（全ユーザー＝トレンド）──
  let weeklyTopPrograms: unknown[] = [];
  try {
    const { data: weekRight } = await supabase
      .from('swipes')
      .select('content_id')
      .eq('direction', 'right')
      .gte('created_at', new Date(weekAgo).toISOString());
    const trendCounts = new Map<string, number>();
    for (const s of (weekRight ?? []) as { content_id: string }[]) {
      trendCounts.set(s.content_id, (trendCounts.get(s.content_id) ?? 0) + 1);
    }
    const trendTopIds = [...trendCounts.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([id]) => id);
    if (trendTopIds.length > 0) {
      const { data: tc } = await supabase
        .from('contents')
        .select('id, title, thumbnail_url, channel_name, content_type')
        .in('id', trendTopIds);
      const m = new Map(((tc ?? []) as ContentRow[]).map((c) => [c.id, c]));
      weeklyTopPrograms = trendTopIds
        .map((id) => {
          const c = m.get(id);
          return c
            ? { id, title: c.title, thumbnail_url: c.thumbnail_url, channel_name: c.channel_name ?? null, content_type: c.content_type ?? null, count: trendCounts.get(id) }
            : null;
        })
        .filter(Boolean);
    }
  } catch {
    weeklyTopPrograms = [];
  }

  // ── 好み傾向：トップジャンルでの上位パーセンタイル ──
  let tastePercentile: { genre: string; topPercent: number } | null = null;
  const topGenre = genreRanking[0]?.name;
  if (topGenre && totalSwipes > 0) {
    try {
      const { data: gc } = await supabase
        .from('contents')
        .select('id')
        .eq('genre', topGenre)
        .limit(500);
      const gids = ((gc ?? []) as { id: string }[]).map((r) => r.id);
      if (gids.length > 0) {
        const { data: gs } = await supabase
          .from('swipes')
          .select('user_id')
          .eq('direction', 'right')
          .in('content_id', gids);
        const per = new Map<string, number>();
        for (const s of (gs ?? []) as { user_id: string }[]) {
          per.set(s.user_id, (per.get(s.user_id) ?? 0) + 1);
        }
        const mine = per.get(userId) ?? 0;
        const counts = [...per.values()];
        const total = counts.length || 1;
        const atOrBelow = counts.filter((c) => c <= mine).length;
        // 自分より下（含む同数）が多いほど上位 → 上位X%
        const topPercent = Math.min(99, Math.max(1, Math.round((1 - atOrBelow / total) * 100) || 1));
        tastePercentile = { genre: topGenre, topPercent };
      }
    } catch {
      tastePercentile = null;
    }
  }

  return NextResponse.json({
    totalSwipes,
    thisWeekCount,
    topPrograms,
    genreRanking,
    stationRanking,
    weeklyTopPrograms,
    tastePercentile,
  });
}
