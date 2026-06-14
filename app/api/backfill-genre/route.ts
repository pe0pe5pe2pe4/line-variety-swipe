import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { inferGenre } from '@/lib/genre';

export const maxDuration = 25;

type Row = {
  id: string;
  title: string;
  description?: string | null;
  channel_name?: string | null;
  content_type?: string | null;
  genre?: string | null;
};

/**
 * contents.genre を title・description・channel_name から推定して埋める。
 * 事前に以下のSQLで genre カラムを追加しておくこと:
 *   ALTER TABLE contents ADD COLUMN IF NOT EXISTS genre text;
 *
 * クエリ ?only_empty=1 で genre が未設定の行のみ対象（デフォルトは全行を再計算）。
 * 認証は CRON_SECRET（Authorization: Bearer <CRON_SECRET>）。
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const onlyEmpty = searchParams.get('only_empty') === '1';

  const pageSize = 1000;
  const chunkSize = 50;
  let from = 0;
  let updated = 0;
  const errors: string[] = [];

  for (;;) {
    const { data, error } = await supabase
      .from('contents')
      .select('id, title, description, channel_name, content_type, genre')
      .range(from, from + pageSize - 1);

    if (error) return NextResponse.json({ error }, { status: 500 });

    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;

    const targets = onlyEmpty ? rows.filter((r) => !(r.genre ?? '').trim()) : rows;

    for (let i = 0; i < targets.length; i += chunkSize) {
      const chunk = targets.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (r) => {
          const genre = inferGenre(r);
          const { error: upErr } = await supabase
            .from('contents')
            .update({ genre })
            .eq('id', r.id);
          if (upErr) {
            if (errors.length < 5) errors.push(`${r.id}: ${upErr.message}`);
          } else {
            updated++;
          }
        })
      );
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return NextResponse.json({
    updated,
    onlyEmpty,
    errors: errors.length ? errors : undefined,
  });
}
