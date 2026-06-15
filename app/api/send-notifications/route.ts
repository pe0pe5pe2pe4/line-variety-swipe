import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { supabase } from '@/lib/supabase';

export const maxDuration = 25;

// その日のおすすめ番組TOP3をプッシュ通知で全購読者に送る（毎日18時JST=9:00 UTC）。
// 認証は CRON_SECRET。VAPID鍵が必要（生成方法は README 参照）。
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: 'VAPID keys not set' }, { status: 500 });
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    publicKey,
    privateKey
  );

  // ── like_rate が高い番組 TOP3 を算出 ──
  const { data: swipes } = await supabase.from('swipes').select('content_id, direction');
  const right = new Map<string, number>();
  const total = new Map<string, number>();
  for (const s of (swipes ?? []) as { content_id: string; direction: string }[]) {
    total.set(s.content_id, (total.get(s.content_id) ?? 0) + 1);
    if (s.direction === 'right') right.set(s.content_id, (right.get(s.content_id) ?? 0) + 1);
  }
  const ranked = [...total.entries()]
    .filter(([, t]) => t >= 3) // ノイズ除去：最低3スワイプ
    .map(([id, t]) => ({ id, rate: (right.get(id) ?? 0) / t }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 3);

  let titles: string[] = [];
  if (ranked.length > 0) {
    const { data: cc } = await supabase
      .from('contents')
      .select('id, title')
      .in('id', ranked.map((r) => r.id));
    const map = new Map(((cc ?? []) as { id: string; title: string }[]).map((c) => [c.id, c.title]));
    titles = ranked.map((r) => map.get(r.id)).filter(Boolean) as string[];
  }
  if (titles.length === 0) {
    return NextResponse.json({ sent: 0, message: 'おすすめ番組が算出できませんでした' });
  }

  const payload = JSON.stringify({
    title: '今日のおすすめ🎬',
    body: `${titles.join('・')}\nタップしてチェック！`,
    url: '/',
  });

  // ── 全購読者へ送信 ──
  const { data: subs } = await supabase.from('push_subscriptions').select('id, subscription');
  let sent = 0;
  let failed = 0;
  const expiredIds: string[] = [];
  for (const row of (subs ?? []) as { id: string; subscription: webpush.PushSubscription }[]) {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent++;
    } catch (e) {
      failed++;
      const status = (e as { statusCode?: number }).statusCode;
      // 410 Gone / 404 → 失効した購読は削除対象
      if (status === 410 || status === 404) expiredIds.push(row.id);
    }
  }

  // 失効した購読を掃除
  if (expiredIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expiredIds);
  }

  return NextResponse.json({ titles, subscribers: (subs ?? []).length, sent, failed, removed: expiredIds.length });
}
