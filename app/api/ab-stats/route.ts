import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

export const maxDuration = 25;

// A/Bテストの計測：群ごとのユーザー数・スワイプ数・1人あたりスワイプ数・右スワイプ率。
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  try {
    const { data: users } = await supabase.from('users').select('line_user_id, ab_group');
    const groupByUser = new Map<string, string>();
    const userCount: Record<string, number> = { A: 0, B: 0 };
    for (const u of (users ?? []) as { line_user_id: string; ab_group?: string | null }[]) {
      const g = u.ab_group === 'B' ? 'B' : 'A';
      groupByUser.set(u.line_user_id, g);
      userCount[g]++;
    }

    const { data: swipes } = await supabase.from('swipes').select('user_id, direction');
    const swipeCount: Record<string, number> = { A: 0, B: 0 };
    const rightCount: Record<string, number> = { A: 0, B: 0 };
    for (const s of (swipes ?? []) as { user_id: string; direction: string }[]) {
      const g = groupByUser.get(s.user_id);
      if (!g) continue;
      swipeCount[g]++;
      if (s.direction === 'right') rightCount[g]++;
    }

    const summarize = (g: string) => ({
      users: userCount[g],
      swipes: swipeCount[g],
      swipesPerUser: userCount[g] > 0 ? Math.round((swipeCount[g] / userCount[g]) * 10) / 10 : 0,
      rightRate: swipeCount[g] > 0 ? Math.round((rightCount[g] / swipeCount[g]) * 100) : 0,
    });

    return NextResponse.json({ A: summarize('A'), B: summarize('B') });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
