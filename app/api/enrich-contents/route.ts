import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveGenre } from '@/lib/genre';
import { enrichBatch } from '@/lib/claude-enricher';

// enriched_description が未設定のコンテンツを Claude API で加工する。
// コスト最適化＆タイムアウト対策：未加工(新規)のみ対象・1回の実行で limit 件だけ処理。
// 事前に: ALTER TABLE contents ADD COLUMN IF NOT EXISTS enriched_description text;
// 認証は CRON_SECRET。

export const maxDuration = 25;

const DEFAULT_LIMIT = 5;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(20, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT));

  // 未加工の総数（残り件数の算出用）
  const { count: totalRemaining } = await supabase
    .from('contents')
    .select('id', { count: 'exact', head: true })
    .is('enriched_description', null);

  // enriched_description が空の行を最大 limit 件取得
  const { data, error } = await supabase
    .from('contents')
    .select('id, title, description, channel_name, content_type, genre, enriched_description')
    .is('enriched_description', null)
    .limit(limit);

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
    return NextResponse.json({ processed: 0, updated: 0, remaining: 0, message: '加工対象なし' });
  }

  const inputs = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    genre: resolveGenre(r),
  }));

  console.log('[enrich-contents] start', { count: inputs.length, hasApiKey: !!process.env.ANTHROPIC_API_KEY });

  const { results, errors } = await enrichBatch(inputs);

  let updated = 0;
  const updateErrors: string[] = [];
  for (const { id, enriched } of results) {
    const { error: upErr } = await supabase
      .from('contents')
      .update({ enriched_description: enriched })
      .eq('id', id);
    if (!upErr) updated++;
    else if (updateErrors.length < 5) updateErrors.push(`${id}: ${upErr.message}`);
  }

  console.log('[enrich-contents] done', { processed: rows.length, updated, claudeErrors: errors.length, updateErrors: updateErrors.length });

  const remaining = Math.max(0, (totalRemaining ?? rows.length) - updated);
  return NextResponse.json({
    processed: rows.length,
    updated,
    remaining,
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    // Claude 呼び出しのエラー詳細（先頭5件）。updated:0 の原因調査用。
    claudeErrors: errors.slice(0, 5),
    updateErrors,
  });
}
