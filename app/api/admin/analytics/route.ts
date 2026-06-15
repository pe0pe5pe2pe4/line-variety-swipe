import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { jstDateString } from '@/lib/premium';

export const maxDuration = 25;

// 管理画面用のビジネス指標（middleware の Basic 認証で保護）。
// DAU/MAU・平均セッション時間・リテンション(1/7/30日)・転換率・アフィリクリック率・日次推移。
const DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    const [usersRes, swipesRes, sessionsRes, clicksRes] = await Promise.all([
      supabase.from('users').select('line_user_id, created_at, is_premium'),
      supabase.from('swipes').select('user_id, created_at'),
      supabase.from('sessions').select('started_at, ended_at'),
      supabase.from('affiliate_clicks').select('id', { count: 'exact', head: true }),
    ]);

    const users = (usersRes.data ?? []) as { line_user_id: string; created_at: string; is_premium?: boolean | null }[];
    const swipes = (swipesRes.data ?? []) as { user_id: string; created_at: string }[];
    const sessions = (sessionsRes.data ?? []) as { started_at: string; ended_at: string | null }[];
    const clickCount = clicksRes.count ?? 0;

    const now = Date.now();
    const today = jstDateString();

    // 日付(JST)→アクティブユーザー集合
    const activeByDay = new Map<string, Set<string>>();
    for (const s of swipes) {
      if (!s.created_at) continue;
      const d = jstDateString(new Date(s.created_at));
      const set = activeByDay.get(d) ?? new Set<string>();
      set.add(s.user_id);
      activeByDay.set(d, set);
    }

    // DAU（本日）/ MAU（過去30日）
    const dau = activeByDay.get(today)?.size ?? 0;
    const mauSet = new Set<string>();
    for (const s of swipes) {
      if (s.created_at && now - new Date(s.created_at).getTime() <= 30 * DAY) mauSet.add(s.user_id);
    }
    const mau = mauSet.size;

    // 平均セッション時間（秒）
    let durSum = 0;
    let durCount = 0;
    for (const ses of sessions) {
      if (ses.started_at && ses.ended_at) {
        const ms = new Date(ses.ended_at).getTime() - new Date(ses.started_at).getTime();
        if (ms > 0 && ms < 6 * 60 * 60 * 1000) { durSum += ms; durCount++; }
      }
    }
    const avgSessionSec = durCount > 0 ? Math.round(durSum / durCount / 1000) : 0;

    // リテンション：登録日コホート → N日後にアクティブだった割合
    const newUsersByDay = new Map<string, string[]>();
    for (const u of users) {
      if (!u.created_at) continue;
      const d = jstDateString(new Date(u.created_at));
      const arr = newUsersByDay.get(d) ?? [];
      arr.push(u.line_user_id);
      newUsersByDay.set(d, arr);
    }
    const retentionForOffset = (offset: number): number | null => {
      // offset 日前に登録したユーザーが、その offset 日後（=本日付近）にアクティブか
      const cohortDate = jstDateString(new Date(now - offset * DAY));
      const cohort = newUsersByDay.get(cohortDate) ?? [];
      if (cohort.length === 0) return null;
      const targetDate = jstDateString(new Date(now)); // 本日のアクティブで近似
      const active = activeByDay.get(targetDate) ?? new Set<string>();
      const retained = cohort.filter((u) => active.has(u)).length;
      return Math.round((retained / cohort.length) * 100);
    };

    // 転換率（プレミアム / 全ユーザー）
    const totalUsers = users.length;
    const premiumUsers = users.filter((u) => u.is_premium).length;
    const conversionRate = totalUsers > 0 ? Math.round((premiumUsers / totalUsers) * 1000) / 10 : 0;

    // アフィリクリック率（クリック / 総スワイプ）
    const clickRate = swipes.length > 0 ? Math.round((clickCount / swipes.length) * 1000) / 10 : 0;

    // 日次推移（過去14日のスワイプ数）
    const daily: { date: string; swipes: number; activeUsers: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = jstDateString(new Date(now - i * DAY));
      const set = activeByDay.get(d);
      const swCount = swipes.filter((s) => s.created_at && jstDateString(new Date(s.created_at)) === d).length;
      daily.push({ date: d, swipes: swCount, activeUsers: set?.size ?? 0 });
    }

    return NextResponse.json({
      dau,
      mau,
      avgSessionSec,
      retention: { d1: retentionForOffset(1), d7: retentionForOffset(7), d30: retentionForOffset(30) },
      conversionRate,
      premiumUsers,
      totalUsers,
      affiliateClickRate: clickRate,
      totalClicks: clickCount,
      totalSwipes: swipes.length,
      daily,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
