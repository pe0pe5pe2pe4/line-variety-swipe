import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');

  if (!userId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }

  const { data: swiped } = await supabase
    .from('swipes')
    .select('content_id')
    .eq('user_id', userId);

    const swipedIds: string[] = swiped?.map((s: any) => s.content_id) ?? [];

  let query = supabase.from('contents').select('*').limit(10);

  if (swipedIds.length > 0) {
    query = query.not('id', 'in', `(${swipedIds.join(',')})`);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json(data);
}