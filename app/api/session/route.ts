import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

// セッション追跡。
// POST { action: 'start'|'end', user_id, session_id?, swipe_count? }
// 事前に sessions テーブルが必要（サマリー参照）。
export async function POST(request: Request) {
  const rl = rateLimit(request, 120);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  let body: { action?: string; user_id?: string; session_id?: string; swipe_count?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  try {
    if (body.action === 'start') {
      // line_user_id → users.id 解決（無ければ null）
      let userUuid: string | null = null;
      if (body.user_id) {
        const { data } = await supabase
          .from('users')
          .select('id')
          .eq('line_user_id', body.user_id)
          .maybeSingle();
        userUuid = (data?.id as string) ?? null;
      }
      const { data, error } = await supabase
        .from('sessions')
        .insert({ user_id: userUuid })
        .select('id')
        .single();
      if (error) return NextResponse.json({ error }, { status: 500 });
      return NextResponse.json({ session_id: data.id });
    }

    if (body.action === 'end') {
      if (!body.session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
      const { error } = await supabase
        .from('sessions')
        .update({ ended_at: new Date().toISOString(), swipe_count: body.swipe_count ?? 0 })
        .eq('id', body.session_id);
      if (error) return NextResponse.json({ error }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
