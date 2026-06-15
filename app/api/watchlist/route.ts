import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

// あとで見るリスト: 右スワイプした番組・動画を新しい順で返す
// direction='right' の swipes と contents を JOIN（重複は最新の1件に集約）
export async function GET(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  if (!userId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }

  const { data: swipes, error: swipeError } = await supabase
    .from('swipes')
    .select('content_id, created_at')
    .eq('user_id', userId)
    .eq('direction', 'right')
    .order('created_at', { ascending: false });

  if (swipeError) {
    return NextResponse.json({ error: swipeError }, { status: 500 });
  }
  if (!swipes?.length) return NextResponse.json([]);

  // 同じコンテンツを複数回右スワイプしても1件に集約（最新順を維持）
  const seen = new Set<string>();
  const orderedIds: string[] = [];
  for (const s of swipes) {
    const id = s.content_id as string;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    orderedIds.push(id);
  }

  const { data: contents, error: contentError } = await supabase
    .from('contents')
    .select('*')
    .in('id', orderedIds);

  if (contentError) {
    return NextResponse.json({ error: contentError }, { status: 500 });
  }

  // スワイプ順（最新優先）に並べ替え
  const contentMap = new Map(
    (contents ?? []).map((c: { id: string }) => [c.id, c])
  );
  const sorted = orderedIds.map((id) => contentMap.get(id)).filter(Boolean);

  return NextResponse.json(sorted);
}

// あとで見るリストから削除（該当コンテンツの right スワイプを取り消す）
// DELETE /api/watchlist?user_id=...&content_id=...
export async function DELETE(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');
  const contentId = searchParams.get('content_id');
  if (!userId || !contentId) {
    return NextResponse.json({ error: 'user_id and content_id required' }, { status: 400 });
  }

  const { error } = await supabase
    .from('swipes')
    .delete()
    .eq('user_id', userId)
    .eq('content_id', contentId)
    .eq('direction', 'right');

  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ success: true });
}
