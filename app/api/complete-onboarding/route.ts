import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

// オンボーディング完了をサーバーに記録する（localStorageに依存せず、
// LINEブラウザでストレージが消えても再びオンボーディングに戻されないようにする）。
// 事前に: ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;
// POST { user_id }
export async function POST(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  let body: { user_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body.user_id) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  try {
    const { error } = await supabase
      .from('users')
      .update({ onboarded_at: new Date().toISOString() })
      .eq('line_user_id', body.user_id);
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
