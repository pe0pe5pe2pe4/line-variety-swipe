import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// 6桁の招待コードを生成（紛らわしい文字を除外）
function genReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function POST(request: Request) {
  const { line_user_id, display_name, picture_url, referred_by } = await request.json();

  if (!line_user_id) {
    return NextResponse.json({ error: 'line_user_id required' }, { status: 400 });
  }

  // 既存ユーザーを確認（referral_code が無ければ採番）
  const { data: existing } = await supabase
    .from('users')
    .select('id, referral_code, referred_by')
    .eq('line_user_id', line_user_id)
    .maybeSingle();

  const referralCode = existing?.referral_code ?? genReferralCode();
  // referred_by は初回のみ確定（自分のコードは不可）
  const newReferredBy =
    existing?.referred_by ??
    (referred_by && referred_by !== referralCode ? referred_by : null);

  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        line_user_id,
        display_name,
        picture_url,
        referral_code: referralCode,
        referred_by: newReferredBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'line_user_id' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json(data);
}
