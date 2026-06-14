import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// あとで見るリスト: 右スワイプしたコンテンツ一覧を返す
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  const { data: swipes, error: swipeError } = await supabase
    .from('swipes')
    .select('content_id')
    .eq('user_id', userId)
    .eq('direction', 'right')
    .order('created_at', { ascending: false });

  if (swipeError) return NextResponse.json({ error: swipeError }, { status: 500 });
  if (!swipes?.length) return NextResponse.json([]);

  // 重複除去
  const seen = new Set<string>();
  const contentIds: string[] = [];
  for (const s of swipes) {
    if (!seen.has(s.content_id)) {
      seen.add(s.content_id);
      contentIds.push(s.content_id);
    }
  }

  const { data: contents, error: contentError } = await supabase
    .from('contents')
    .select('*')
    .in('id', contentIds);

  if (contentError) return NextResponse.json({ error: contentError }, { status: 500 });

  // スワイプ順（最新優先）に並べ替え
  const contentMap = new Map((contents ?? []).map((c: { id: string }) => [c.id, c]));
  const sorted = contentIds.map((id) => contentMap.get(id)).filter(Boolean);

  return NextResponse.json(sorted);
}

export async function POST(request: Request) {
  const { user_id, content_id, direction } = await request.json();

  if (!user_id || !content_id || !direction) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  const { error } = await supabase.from('swipes').insert({
    user_id,
    content_id,
    direction,
    created_at: new Date().toISOString(),
  });

  // 23505 = unique_violation（同一コンテンツの再スワイプ）は既に記録済みなので成功扱い
  if (error && error.code !== '23505') {
    return NextResponse.json({ error }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}