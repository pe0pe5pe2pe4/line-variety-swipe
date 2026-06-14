import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveGenre } from '@/lib/genre';
import { enrichBatch } from '@/lib/claude-enricher';

// enriched_description が未設定のコンテンツを Claude API で加工する。
// コスト最適化：未加工(新規)のみ対象・1回の実行で最大20件だけ処理。
// 事前に: ALTER TABLE contents ADD COLUMN IF NOT EXISTS enriched_description text;
// 認証は CRON_SECRET。

const BATCH_SIZE = 20;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
  }

  // enriched_description が空の行を最大 BATCH_SIZE 件取得
  const { data, error } = await supabase
    .from('contents')
    .select('id, title, description, channel_name, content_type, genre, enriched_description')
    .is('enriched_description', null)
    .limit(BATCH_SIZE);

  if (error) return NextResponse.json({ error }, { status: 500 });

  const rows = (data ?? []) as {
    id: string;
    title: string;
    description?: string | null;
    channel_name?: string | null;
    content_type?: string | null;
    genre?: string | null;
  }[];

  if (rows.length === 0) {
    return NextResponse.json({ processed: 0, updated: 0, message: '加工対象なし' });
  }

  const inputs = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    genre: resolveGenre(r),
  }));

  const results = await enrichBatch(inputs);

  let updated = 0;
  for (const { id, enriched } of results) {
    const { error: upErr } = await supabase
      .from('contents')
      .update({ enriched_description: enriched })
      .eq('id', id);
    if (!upErr) updated++;
  }

  return NextResponse.json({ processed: rows.length, updated });
}
