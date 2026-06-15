// contents テーブルに genre カラムが無いため、タイトル・説明・チャンネル名から
// ジャンルを推定する。レコメンド重み付け／ジャンルタグ／統計で共通利用する。

type GenreRule = { key: string; keywords: string[] };

// 正規化された8ジャンルに統一する
export const NORMALIZED_GENRES = [
  'お笑い・バラエティ',
  'トーク',
  '情報・ワイドショー',
  'ドッキリ・企画',
  'グルメ・旅',
  '音楽',
  'スポーツ',
  'その他',
] as const;

const GENRE_RULES: GenreRule[] = [
  { key: 'お笑い・バラエティ', keywords: ['お笑い', '芸人', '漫才', 'コント', 'ネタ', 'ものまね', 'M-1', 'バラエティ', '大喜利', 'クイズ', '謎解き', '千鳥', 'かまいたち', '霜降り', 'ダウンタウン', '有吉', 'バナナマン', 'サンドウィッチマン', 'ナイツ'] },
  { key: 'トーク', keywords: ['トーク', '対談', 'インタビュー', '人生相談', '悩み相談', '井戸端', 'ぶっちゃけ'] },
  { key: '情報・ワイドショー', keywords: ['ニュース', '報道', '情報番組', 'ワイドショー', '時事', '解説', '密着', '特集'] },
  { key: 'ドッキリ・企画', keywords: ['ドッキリ', 'モニタリング', '検証', '企画', 'いたずら', '実験', 'チャレンジ'] },
  { key: 'グルメ・旅', keywords: ['グルメ', '料理', 'メシ', '飯', 'ごはん', 'レシピ', 'ラーメン', 'スイーツ', '食堂', '大食い', '旅', '旅行', '温泉', '観光', 'ロケ', '秘境', '絶景', 'ひとり旅'] },
  { key: '音楽', keywords: ['音楽', 'ライブ', 'ミュージック', 'MV', 'うた', 'カラオケ', '歌', 'バンド', 'フェス'] },
  { key: 'スポーツ', keywords: ['スポーツ', '野球', 'サッカー', '格闘', 'プロレス', '筋トレ', 'マラソン', 'オリンピック'] },
];

export type GenreSource = {
  title?: string | null;
  description?: string | null;
  channel_name?: string | null;
  content_type?: string | null;
};

/** 1コンテンツのジャンルを推定（8カテゴリに正規化・該当なしは「その他」） */
export function inferGenre(c: GenreSource): string {
  const text = `${c.title ?? ''} ${c.description ?? ''} ${c.channel_name ?? ''}`;
  for (const rule of GENRE_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.key;
  }
  return 'その他';
}

/** DBに保存済みの genre があればそれを優先、無ければ推定する */
export function resolveGenre(c: GenreSource & { genre?: string | null }): string {
  const stored = (c.genre ?? '').trim();
  return stored || inferGenre(c);
}

// ジャンルタグの配色（Tailwind クラス）
const GENRE_COLORS: Record<string, string> = {
  'お笑い・バラエティ': 'bg-yellow-400 text-black',
  'トーク': 'bg-blue-500 text-white',
  '情報・ワイドショー': 'bg-cyan-500 text-white',
  'ドッキリ・企画': 'bg-red-500 text-white',
  'グルメ・旅': 'bg-orange-500 text-white',
  '音楽': 'bg-purple-500 text-white',
  'スポーツ': 'bg-green-500 text-white',
  'その他': 'bg-slate-500 text-white',
};

export function genreColorClass(genre: string): string {
  return GENRE_COLORS[genre] ?? 'bg-indigo-500 text-white';
}
