import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

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

  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ success: true });
}