import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { extractYouTubeId } from '@/lib/types';

export const maxDuration = 25;

// YouTube コンテンツの実再生数＋チャンネル登録者数を取得して保存する。
// - yt_view_count: 「数万〜数十万再生の知らないけど面白い人」のミドル帯選定に使用
// - yt_subscriber_count: 再生数÷登録者数のギャップ＝「登録者は少ないのに再生されてる」
//   ＝面白さが数字で証明された無名（隠れた実力派）を見つける発掘シグナル
// videos.list / channels.list は50件まとめて1ユニット＝高速・低コスト。
// 事前に:
//   ALTER TABLE contents ADD COLUMN IF NOT EXISTS yt_view_count integer;
//   ALTER TABLE contents ADD COLUMN IF NOT EXISTS yt_subscriber_count integer;
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

// yt_subscriber_count 列が未作成のDBでも落ちないよう、失敗時は列を抜いて再試行
async function updateRow(id: string, payload: Record<string, number>): Promise<boolean> {
  const { error } = await supabase.from('contents').update(payload).eq('id', id);
  if (!error) return true;
  if ('yt_subscriber_count' in payload) {
    const { yt_subscriber_count: _drop, ...rest } = payload;
    void _drop;
    if (Object.keys(rest).length === 0) return false;
    const { error: e2 } = await supabase.from('contents').update(rest).eq('id', id);
    return !e2;
  }
  return false;
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

  // 未取得（再生数 or 登録者数のどちらかが null）の行を対象にする。
  // yt_subscriber_count 列が無いDBでは or フィルタが失敗するので、その場合は従来条件で再取得。
  type TargetRow = { id: string; youtube_url: string | null };
  let data: TargetRow[] | null = null;
  {
    const res = await supabase
      .from('contents')
      .select('id, youtube_url')
      .eq('content_type', 'youtube')
      .or('yt_view_count.is.null,yt_subscriber_count.is.null')
      .limit(limit);
    if (!res.error) data = (res.data ?? []) as TargetRow[];
  }
  if (!data) {
    const res = await supabase
      .from('contents')
      .select('id, youtube_url')
      .eq('content_type', 'youtube')
      .is('yt_view_count', null)
      .limit(limit);
    if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });
    data = (res.data ?? []) as TargetRow[];
  }

  const rows = (data ?? [])
    .map((r) => ({ id: r.id, vid: extractYouTubeId(r.youtube_url) }))
    .filter((r): r is { id: string; vid: string } => !!r.vid);

  const started = Date.now();
  let updated = 0;
  let processed = 0;
  let channelsFetched = 0;

  for (let i = 0; i < rows.length; i += 50) {
    if (Date.now() - started > DEADLINE_MS) break;
    const chunk = rows.slice(i, i + 50);
    processed += chunk.length;
    const vidToId = new Map(chunk.map((r) => [r.vid, r.id]));

    // ① 動画の統計＋チャンネルID（part をいくつ足しても videos.list は1ユニット）
    const vParams = new URLSearchParams({
      part: 'statistics,snippet',
      id: chunk.map((r) => r.vid).join(','),
      key: apiKey,
    });
    const vRes = await ytFetch(`${YT_API}/videos?${vParams}`);
    if (!vRes || !vRes.ok) continue;
    const vJson = await vRes.json();
    const items = (vJson.items ?? []) as {
      id: string;
      statistics?: { viewCount?: string };
      snippet?: { channelId?: string };
    }[];

    // ② チャンネル登録者数（ユニークなチャンネルIDでまとめて1回）
    const channelIds = [...new Set(items.map((it) => it.snippet?.channelId).filter(Boolean))] as string[];
    const subsByChannel = new Map<string, number>();
    if (channelIds.length > 0 && Date.now() - started < DEADLINE_MS) {
      const cParams = new URLSearchParams({ part: 'statistics', id: channelIds.join(','), key: apiKey });
      const cRes = await ytFetch(`${YT_API}/channels?${cParams}`);
      if (cRes && cRes.ok) {
        const cJson = await cRes.json();
        for (const ch of (cJson.items ?? []) as {
          id: string;
          statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
        }[]) {
          const subs = ch.statistics?.hiddenSubscriberCount
            ? -1 // 非公開 → 再取得しない目印
            : Number(ch.statistics?.subscriberCount ?? 0) || 0;
          subsByChannel.set(ch.id, subs);
          channelsFetched++;
        }
      }
    }

    const found = new Set<string>();
    await Promise.all(
      items.map(async (it) => {
        const cid = vidToId.get(it.id);
        if (!cid) return;
        found.add(it.id);
        const views = Number(it.statistics?.viewCount ?? 0) || 0;
        const chId = it.snippet?.channelId;
        const subs = chId != null ? subsByChannel.get(chId) : undefined;
        const payload: Record<string, number> = { yt_view_count: views };
        // 取得できなかったチャンネルは -1（再取得防止）。列が無いDBでは updateRow が自動フォールバック
        payload.yt_subscriber_count = typeof subs === 'number' ? subs : -1;
        if (await updateRow(cid, payload)) updated++;
      })
    );
    // 統計が取れなかった(削除/非公開)動画は -1 を入れて再取得を防ぐ
    const missing = chunk.filter((r) => !found.has(r.vid));
    await Promise.all(
      missing.map((r) => updateRow(r.id, { yt_view_count: -1, yt_subscriber_count: -1 }))
    );
  }

  return NextResponse.json({
    processed,
    updated,
    channelsFetched,
    remaining: Math.max(0, rows.length - processed),
  });
}
