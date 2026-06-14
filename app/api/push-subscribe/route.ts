import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

// Web Push の購読情報を保存する。
// 事前に push_subscriptions テーブルを作成しておくこと（README/サマリー参照）。
// POST { user_id (line_user_id), subscription }
export async function POST(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  let body: { user_id?: string; subscription?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { user_id, subscription } = body;
  if (!subscription) {
    return NextResponse.json({ error: 'subscription required' }, { status: 400 });
  }

  try {
    // line_user_id → users.id を解決（push_subscriptions.user_id は users.id を参照）
    let userUuid: string | null = null;
    if (user_id) {
      const { data: userRow } = await supabase
        .from('users')
        .select('id')
        .eq('line_user_id', user_id)
        .maybeSingle();
      userUuid = (userRow?.id as string) ?? null;
    }

    // 同一エンドポイントの重複を避ける
    const endpoint = (subscription as { endpoint?: string }).endpoint;
    if (endpoint) {
      await supabase.from('push_subscriptions').delete().filter('subscription->>endpoint', 'eq', endpoint);
    }

    const { error } = await supabase.from('push_subscriptions').insert({
      user_id: userUuid,
      subscription,
    });

    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
