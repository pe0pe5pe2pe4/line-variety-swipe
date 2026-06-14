import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const maxDuration = 25;

// 対応サービス（Netflixはアフィリエイト対象外なので含めない）
const SERVICES = ['unext', 'hulu', 'amazon'] as const;
type Service = (typeof SERVICES)[number];

/**
 * アフィリエイトリンク一括設定。
 * POST { service: "unext"|"hulu"|"amazon", base_url: "https://..." }
 * contents 全番組の vod_affiliate_url を `base_url + encodeURIComponent(番組名)` で一括更新する。
 * 認証は CRON_SECRET（Authorization: Bearer <CRON_SECRET>）。
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { service?: string; base_url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const service = body.service;
  const baseUrl = (body.base_url ?? '').trim();

  if (!service || !SERVICES.includes(service as Service)) {
    return NextResponse.json(
      { error: 'service must be one of unext | hulu | amazon' },
      { status: 400 }
    );
  }
  if (!baseUrl) {
    return NextResponse.json({ error: 'base_url required' }, { status: 400 });
  }

  // 全番組をページングで取得し、タイトルをURLエンコードして末尾に付与して更新
  const pageSize = 1000;
  const chunkSize = 50;
  let from = 0;
  let updated = 0;
  const errors: string[] = [];

  for (;;) {
    const { data, error } = await supabase
      .from('contents')
      .select('id, title')
      .range(from, from + pageSize - 1);

    if (error) return NextResponse.json({ error }, { status: 500 });

    const rows = (data ?? []) as { id: string; title: string }[];
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (r) => {
          const url = `${baseUrl}${encodeURIComponent(r.title ?? '')}`;
          const { error: upErr } = await supabase
            .from('contents')
            .update({ vod_affiliate_url: url })
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
    service,
    base_url: baseUrl,
    updated,
    errors: errors.length ? errors : undefined,
  });
}
