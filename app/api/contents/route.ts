import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

type ContentRow = {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  vod_affiliate_url: string;
};

const STOP_WORDS = new Set([
  'の','は','が','を','に','で','と','も','な','た','て','い','る','し',
  'こ','そ','あ','さ','れ','か','う','よ','ん','だ','や','ら','ま','す',
  'せ','く','ない','から','まで','より','など','ため','こと','もの',
]);

function extractKeywords(text: string): string[] {
  return text
    .split(/[\s　、。・！？「」『』【】\n\r]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function buildFreqMap(contents: { title: string; description: string }[]): Record<string, number> {
  const freq: Record<string, number> = {};
  for (const c of contents) {
    const words = extractKeywords(`${c.title} ${c.description ?? ''}`);
    for (const w of words) {
      freq[w] = (freq[w] ?? 0) + 1;
    }
  }
  return freq;
}

function scoreContent(c: ContentRow, freq: Record<string, number>): number {
  const words = extractKeywords(`${c.title} ${c.description ?? ''}`);
  return words.reduce((sum, w) => sum + (freq[w] ?? 0), 0);
}

// 好みスコアを重みにしつつランダム性を加えるシャッフル
// スコアが高いほど上位に出やすいが、毎回順番が変わる
function weightedShuffle(items: (ContentRow & { _score: number })[]): ContentRow[] {
  const maxScore = Math.max(...items.map((i) => i._score), 1);
  return items
    .map((item) => ({
      item,
      // スコア(0〜1正規化) × 0.7 + ランダム(0〜1) × 0.3
      // → 好みスコアを優先しつつ毎回異なる順番になる
      sortKey: (item._score / maxScore) * 0.7 + Math.random() * 0.3,
    }))
    .sort((a, b) => b.sortKey - a.sortKey)
    .map(({ item: { _score: _s, ...c } }) => c as ContentRow);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id');

  if (!userId) {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 });
  }

  const { data: allSwipes } = await supabase
    .from('swipes')
    .select('content_id, direction')
    .eq('user_id', userId);

  const swipedIds: string[] = allSwipes?.map((s: any) => s.content_id) ?? [];
  const likedIds: string[] = allSwipes
    ?.filter((s: any) => s.direction === 'right')
    .map((s: any) => s.content_id) ?? [];

  // 未スワイプを最大100件取得してスコアリング後に10件返す
  // descriptionがある行を優先（descending nullsFirst:falseでNULLを後ろに）
  let query = supabase
    .from('contents')
    .select('*')
    .order('description', { ascending: false, nullsFirst: false })
    .limit(100);
  if (swipedIds.length > 0) {
    query = query.not('id', 'in', `(${swipedIds.join(',')})`);
  }

  const { data: candidates, error } = await query;
  if (error) return NextResponse.json({ error }, { status: 500 });

  // タイトル重複行は最初の1件のみ残す（descriptionがある行が先に来るため優先される）
  const seenTitles = new Set<string>();
  const list = ((candidates ?? []) as ContentRow[]).filter((c) => {
    if (seenTitles.has(c.title)) return false;
    seenTitles.add(c.title);
    return true;
  });

  // 右スワイプ履歴がなければ純粋なランダム順で返す
  if (likedIds.length === 0) {
    const shuffled = [...list].sort(() => Math.random() - 0.5).slice(0, 10);
    return NextResponse.json(shuffled);
  }

  const { data: likedContents } = await supabase
    .from('contents')
    .select('title, description')
    .in('id', likedIds);

  const freqMap = buildFreqMap(
    (likedContents ?? []) as { title: string; description: string }[]
  );

  const scored = list.map((c) => ({ ...c, _score: scoreContent(c, freqMap) }));
  const result = weightedShuffle(scored).slice(0, 10);

  return NextResponse.json(result);
}
