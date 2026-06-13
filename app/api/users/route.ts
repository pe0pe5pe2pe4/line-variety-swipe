import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: Request) {
  const { line_user_id, display_name, picture_url } = await request.json();

  if (!line_user_id) {
    return NextResponse.json({ error: 'line_user_id required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('users')
    .upsert(
      { line_user_id, display_name, picture_url, updated_at: new Date().toISOString() },
      { onConflict: 'line_user_id' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json(data);
}