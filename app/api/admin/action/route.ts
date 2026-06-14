import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// 管理画面のアクション（middleware の Basic 認証で保護）。
// POST { type: 'hide'|'unhide'|'run'|'set-affiliate', ... }
export const maxDuration = 25;

const RUN_JOBS = new Set([
  'enrich-contents',
  'ingest-youtube',
  'ingest-tver',
  'ingest-wikipedia',
  'backfill-genre',
  'dedupe',
]);

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const type = body.type as string;

  try {
    // いいね率が低いコンテンツを非表示（thumbnail_url を no_image にして候補から除外）
    if (type === 'hide' || type === 'unhide') {
      const id = body.content_id as string;
      if (!id) return NextResponse.json({ error: 'content_id required' }, { status: 400 });
      const value = type === 'hide' ? 'no_image' : (body.thumbnail_url as string) ?? '';
      const { error } = await supabase.from('contents').update({ thumbnail_url: value }).eq('id', id);
      if (error) return NextResponse.json({ error }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    // ingest/enrich 系を手動実行（CRON_SECRET を付けて内部エンドポイントを叩く）
    if (type === 'run') {
      const job = String(body.job ?? '');
      if (!RUN_JOBS.has(job)) return NextResponse.json({ error: 'unknown job' }, { status: 400 });
      const origin = new URL(request.url).origin;
      const qs = (body.query as string) ?? '';
      const url = `${origin}/api/${job}${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
      });
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ job, status: res.status, result: data });
    }

    // アフィリエイトリンク一括設定（/api/set-affiliate を内部呼び出し）
    if (type === 'set-affiliate') {
      const origin = new URL(request.url).origin;
      const res = await fetch(`${origin}/api/set-affiliate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
        body: JSON.stringify({ service: body.service, base_url: body.base_url }),
      });
      const data = await res.json().catch(() => ({}));
      return NextResponse.json({ status: res.status, result: data });
    }

    return NextResponse.json({ error: 'unknown type' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
