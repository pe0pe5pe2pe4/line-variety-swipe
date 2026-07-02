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
  'backfill-yt-views',
  'grow-discovery',
  'find-previews',
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

    // 人力キュレーション判定を保存。
    // good → curated=true + quality_score=1（推薦で強ブースト・コールドスタート先頭へ）
    // bad  → curated=false + quality_score=0.1（品質フィルタ(<0.3)で表示対象から外れる）
    if (type === 'curate') {
      const id = body.content_id as string;
      const verdict = body.verdict as string;
      if (!id || (verdict !== 'good' && verdict !== 'bad')) {
        return NextResponse.json({ error: 'content_id and verdict(good|bad) required' }, { status: 400 });
      }
      const payload =
        verdict === 'good'
          ? { curated: true, quality_score: 1 }
          : { curated: false, quality_score: 0.1 };
      const { error } = await supabase.from('contents').update(payload).eq('id', id);
      if (error) {
        return NextResponse.json(
          {
            error: String(error.message ?? error),
            hint: '先に SQL を実行: ALTER TABLE contents ADD COLUMN IF NOT EXISTS curated boolean;',
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, verdict });
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
