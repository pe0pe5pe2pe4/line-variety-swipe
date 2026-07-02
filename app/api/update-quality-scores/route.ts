import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hasValidThumbnail } from '@/lib/types';

export const maxDuration = 25;

// 全コンテンツの quality_score を再計算する。
// 計算式：like_rate(40%) + has_image(20%) + has_description(20%) + is_recent7d(20%)
// 事前に: ALTER TABLE contents ADD COLUMN IF NOT EXISTS quality_score float DEFAULT 0.5;
// ?offset で分割実行可。認証は CRON_SECRET。
const DAY = 24 * 60 * 60 * 1000;
const PAGE = 500;
const DEADLINE_MS = 22000;

type Row = {
  id: string;
  thumbnail_url: string | null;
  description: string | null;
  created_at: string | null;
  curated?: boolean | null;
};

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const startOffset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);

  // スワイプ集計（content_id ごとの right/total）
  const { data: swipes } = await supabase.from('swipes').select('content_id, direction');
  const right = new Map<string, number>();
  const total = new Map<string, number>();
  for (const s of (swipes ?? []) as { content_id: string; direction: string }[]) {
    total.set(s.content_id, (total.get(s.content_id) ?? 0) + 1);
    if (s.direction === 'right') right.set(s.content_id, (right.get(s.content_id) ?? 0) + 1);
  }

  const started = Date.now();
  const now = Date.now();
  let offset = startOffset;
  let updated = 0;
  let done = false;

  while (Date.now() - started < DEADLINE_MS) {
    // curated 列が未作成のDBでも動くよう、失敗したら curated 抜きで再取得
    let rows: Row[] = [];
    {
      const res = await supabase
        .from('contents')
        .select('id, thumbnail_url, description, created_at, curated')
        .range(offset, offset + PAGE - 1);
      if (!res.error) rows = (res.data ?? []) as Row[];
      else {
        const res2 = await supabase
          .from('contents')
          .select('id, thumbnail_url, description, created_at')
          .range(offset, offset + PAGE - 1);
        if (res2.error) return NextResponse.json({ error: res2.error }, { status: 500 });
        rows = (res2.data ?? []) as Row[];
      }
    }
    if (rows.length === 0) { done = true; break; }

    await Promise.all(
      rows.map(async (r) => {
        // 人力キュレーション済みは上書きしない（目利きの判定が最優先）
        if (r.curated === true || r.curated === false) return;
        const t = total.get(r.id) ?? 0;
        const likeRate = t > 0 ? (right.get(r.id) ?? 0) / t : 0.5;
        const hasImage = hasValidThumbnail(r.thumbnail_url) ? 1 : 0;
        const hasDesc = (r.description ?? '').trim().length > 0 ? 1 : 0;
        const isRecent = r.created_at && now - new Date(r.created_at).getTime() <= 7 * DAY ? 1 : 0;
        const score = 0.4 * likeRate + 0.2 * hasImage + 0.2 * hasDesc + 0.2 * isRecent;
        const { error: upErr } = await supabase
          .from('contents')
          .update({ quality_score: Math.round(score * 1000) / 1000 })
          .eq('id', r.id);
        if (!upErr) updated++;
      })
    );

    offset += rows.length;
    if (rows.length < PAGE) { done = true; break; }
  }

  return NextResponse.json({ updated, processedUpTo: offset, done, nextOffset: done ? null : offset });
}
