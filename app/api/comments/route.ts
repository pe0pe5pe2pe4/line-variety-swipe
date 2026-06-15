import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

// 番組へのコメント。
// GET ?content_id=...  → 最新5件
// POST { user_id?(line_user_id), content_id, text }（200文字以内）
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const contentId = searchParams.get('content_id');
  if (!contentId) return NextResponse.json({ error: 'content_id required' }, { status: 400 });

  try {
    const { data, error } = await supabase
      .from('comments')
      .select('id, text, created_at, user_id')
      .eq('content_id', contentId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) return NextResponse.json({ error }, { status: 500 });

    // 投稿者名を解決（任意）
    const userIds = [...new Set((data ?? []).map((c) => c.user_id).filter(Boolean))] as string[];
    const nameMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: users } = await supabase.from('users').select('id, display_name').in('id', userIds);
      for (const u of users ?? []) nameMap.set(u.id as string, (u.display_name as string) ?? '匿名');
    }

    const comments = (data ?? []).map((c) => ({
      id: c.id,
      text: c.text,
      created_at: c.created_at,
      name: c.user_id ? nameMap.get(c.user_id as string) ?? '匿名' : '匿名',
    }));
    return NextResponse.json(comments);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  let body: { user_id?: string | null; content_id?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { user_id, content_id, text } = body;
  const trimmed = (text ?? '').trim();
  if (!content_id || !trimmed) {
    return NextResponse.json({ error: 'content_id and text required' }, { status: 400 });
  }
  if (trimmed.length > 200) {
    return NextResponse.json({ error: 'text too long (max 200)' }, { status: 400 });
  }

  try {
    // line_user_id → users.id を解決（comments.user_id は users.id 参照・無ければ null）
    let userUuid: string | null = null;
    if (user_id) {
      const { data: userRow } = await supabase
        .from('users')
        .select('id')
        .eq('line_user_id', user_id)
        .maybeSingle();
      userUuid = (userRow?.id as string) ?? null;
    }

    const { error } = await supabase
      .from('comments')
      .insert({ user_id: userUuid, content_id, text: trimmed });
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
