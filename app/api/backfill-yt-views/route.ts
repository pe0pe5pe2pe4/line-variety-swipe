import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { extractYouTubeId } from '@/lib/types';

export const maxDuration = 25;

// YouTube コンテンツの実再生数を取得して yt_view_count に保存する。
// 発掘で「数万〜数十万再生の知らないけど面白い人」を選ぶための材料。
// videos.list?part=statistics は50件まとめて1ユニット＝高速・低コスト。
// 事前に: ALTER TABLE contents ADD COLUMN IF NOT EXISTS yt_view_count integer;
// ?limit（既定200・最大500）/ 認証は CRON_SECRET。
const YT_API = 'https://www.googleapis.com/youtube/v3';
const TIMEOUT_MS = 7000;
const DEADLINE_MS = 22000;

async function ytFetch(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const limit = Math.max(50, Math.min(500, parseInt(searchParams.get('limit') ?? '200', 10) || 200));

  const { data, error } = await supabase
    .from('contents')
    .select('id, youtube_url')
    .eq('content_type', 'youtube')
    .is('yt_view_count', null)
    .limit(limit);
  if (error) return NextResponse.json({ error }, { status: 500 });

  const rows = ((data ?? []) as { id: string; youtube_url: string | null }[])
    .map((r) => ({ id: r.id, vid: extractYouTubeId(r.youtube_url) }))
    .filter((r): r is { id: string; vid: string } => !!r.vid);

  const { count: remainingBefore } = await supabase
    .from('contents')
    .select('id', { count: 'exact', head: true })
    .eq('content_type', 'youtube')
    .is('yt_view_count', null);

  const started = Date.now();
  let updated = 0;
  let processed = 0;

  for (let i = 0; i < rows.length; i += 50) {
    if (Date.now() - started > DEADLINE_MS) break;
    const chunk = rows.slice(i, i + 50);
    processed += chunk.length;
    const vidToId = new Map(chunk.map((r) => [r.vid, r.id]));
    const params = new URLSearchParams({ part: 'statistics', id: chunk.map((r) => r.vid).join(','), key: apiKey });
    const res = await ytFetch(`${YT_API}/videos?${params}`);
    if (!res || !res.ok) continue;
    const json = await res.json();
    const items = (json.items ?? []) as { id: string; statistics?: { viewCount?: string } }[];
    const found = new Set<string>();
    await Promise.all(
      items.map(async (it) => {
        const cid = vidToId.get(it.id);
        if (!cid) return;
        found.add(it.id);
        const views = Number(it.statistics?.viewCount ?? 0) || 0;
        const { error: upErr } = await supabase.from('contents').update({ yt_view_count: views }).eq('id', cid);
        if (!upErr) updated++;
      })
    );
    // 統計が取れなかった(削除/非公開)動画は -1 を入れて再取得を防ぐ
    const missing = chunk.filter((r) => !found.has(r.vid));
    await Promise.all(
      missing.map((r) => supabase.from('contents').update({ yt_view_count: -1 }).eq('id', r.id))
    );
  }

  return NextResponse.json({
    processed,
    updated,
    remaining: Math.max(0, (remainingBefore ?? rows.length) - processed),
  });
}
