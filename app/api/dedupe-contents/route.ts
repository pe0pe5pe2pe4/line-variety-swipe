import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hasValidThumbnail } from '@/lib/types';

// タイトルが完全一致する重複コンテンツを削除する。
// 残す基準：サムネイル画像がある行を優先（同条件なら最初の1件）。
// swipes から参照されている行はFK制約で削除に失敗しうるため、その場合はスキップする。
// 認証は CRON_SECRET。

type Row = { id: string; title: string; thumbnail_url: string | null };

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 全行を取得
  const all: Row[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('contents')
      .select('id, title, thumbnail_url')
      .range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error }, { status: 500 });
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  // タイトル（正規化）でグルーピング
  const groups = new Map<string, Row[]>();
  for (const r of all) {
    const key = (r.title ?? '').trim().toLowerCase();
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  // 各グループで残す1件を決め、それ以外を削除対象に
  const toDelete: string[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const withThumb = rows.filter((r) => hasValidThumbnail(r.thumbnail_url));
    const keep = (withThumb[0] ?? rows[0]).id;
    for (const r of rows) {
      if (r.id !== keep) toDelete.push(r.id);
    }
  }

  // チャンクで削除（FK参照がある行はエラーになるのでスキップ集計）
  let deleted = 0;
  let skipped = 0;
  const chunkSize = 50;
  for (let i = 0; i < toDelete.length; i += chunkSize) {
    const chunk = toDelete.slice(i, i + chunkSize);
    const { error } = await supabase.from('contents').delete().in('id', chunk);
    if (error) {
      // まとめて失敗した場合は1件ずつ試す
      for (const id of chunk) {
        const { error: e } = await supabase.from('contents').delete().eq('id', id);
        if (e) skipped++;
        else deleted++;
      }
    } else {
      deleted += chunk.length;
    }
  }

  // ── YouTube: 同一チャンネルから10件以上ある場合は5件に絞る（バグ3）──
  let ytTrimmed = 0;
  try {
    const { data: yt } = await supabase
      .from('contents')
      .select('id, channel_name, thumbnail_url')
      .eq('content_type', 'youtube');
    type YtRow = { id: string; channel_name: string | null; thumbnail_url: string | null };
    const byChannel = new Map<string, YtRow[]>();
    for (const r of (yt ?? []) as YtRow[]) {
      const ch = (r.channel_name ?? '').trim();
      if (!ch) continue;
      const arr = byChannel.get(ch) ?? [];
      arr.push(r);
      byChannel.set(ch, arr);
    }
    const ytDelete: string[] = [];
    for (const rows of byChannel.values()) {
      if (rows.length < 10) continue;
      // サムネのある行を優先して5件残す
      const sorted = [...rows].sort(
        (a, b) => Number(hasValidThumbnail(b.thumbnail_url)) - Number(hasValidThumbnail(a.thumbnail_url))
      );
      for (const r of sorted.slice(5)) ytDelete.push(r.id);
    }
    for (let i = 0; i < ytDelete.length; i += chunkSize) {
      const chunk = ytDelete.slice(i, i + chunkSize);
      const { error } = await supabase.from('contents').delete().in('id', chunk);
      if (!error) ytTrimmed += chunk.length;
    }
  } catch {
    // 失敗しても致命的ではない
  }

  return NextResponse.json({
    totalRows: all.length,
    duplicateGroups: [...groups.values()].filter((g) => g.length > 1).length,
    candidates: toDelete.length,
    deleted,
    skipped,
    ytTrimmed,
  });
}
