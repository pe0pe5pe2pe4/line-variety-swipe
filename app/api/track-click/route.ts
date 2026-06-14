import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

// VODボタンのクリックを記録し、contents.view_count を加算する。
// 事前に affiliate_clicks テーブルと contents.view_count 列が必要（サマリー参照）。
// POST { user_id (line_user_id|null), content_id, service }
export async function POST(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  let body: { user_id?: string | null; content_id?: string; service?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { user_id, content_id, service } = body;
  if (!content_id || !service) {
    return NextResponse.json({ error: 'content_id and service required' }, { status: 400 });
  }

  try {
    // line_user_id → users.id を解決（affiliate_clicks.user_id は users.id 参照）
    let userUuid: string | null = null;
    if (user_id) {
      const { data: userRow } = await supabase
        .from('users')
        .select('id')
        .eq('line_user_id', user_id)
        .maybeSingle();
      userUuid = (userRow?.id as string) ?? null;
    }

    await supabase.from('affiliate_clicks').insert({
      user_id: userUuid,
      content_id,
      service,
    });

    // view_count を加算（read-modify-write）
    const { data: row } = await supabase
      .from('contents')
      .select('view_count')
      .eq('id', content_id)
      .maybeSingle();
    const current = Number((row as { view_count?: number } | null)?.view_count ?? 0);
    await supabase.from('contents').update({ view_count: current + 1 }).eq('id', content_id);

    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
