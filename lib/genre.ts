// contents テーブルに genre カラムが無いため、タイトル・説明・チャンネル名から
// ジャンルを推定する。レコメンド重み付け／ジャンルタグ／統計で共通利用する。

type GenreRule = { key: string; keywords: string[] };

const GENRE_RULES: GenreRule[] = [
  { key: 'お笑い', keywords: ['お笑い', '芸人', '漫才', 'コント', 'ネタ', 'ものまね', 'M-1', '千鳥', 'かまいたち', '霜降り', 'ダウンタウン', '有吉', 'バナナマン', 'サンドウィッチマン', 'ナイツ'] },
  { key: '音楽', keywords: ['音楽', 'ライブ', 'ミュージック', 'MV', 'うた', 'カラオケ', '歌', 'バンド', 'フェス'] },
  { key: 'グルメ', keywords: ['グルメ', '料理', 'メシ', '飯', 'ごはん', 'レシピ', 'ラーメン', 'スイーツ', '食堂', '大食い'] },
  { key: '旅', keywords: ['旅', '旅行', '温泉', '観光', 'ロケ', '秘境', '絶景', 'ひとり旅'] },
  { key: 'スポーツ', keywords: ['スポーツ', '野球', 'サッカー', '格闘', 'プロレス', '筋トレ', 'マラソン', 'オリンピック'] },
  { key: 'ドラマ', keywords: ['ドラマ', '恋愛', 'サスペンス', '刑事', '物語'] },
  { key: 'アニメ', keywords: ['アニメ', '声優', 'コミック'] },
  { key: 'ニュース', keywords: ['ニュース', '報道', '情報番組', '時事', '密着'] },
  { key: 'クイズ', keywords: ['クイズ', '謎解き', '検定', '知識王'] },
  { key: 'ドッキリ', keywords: ['ドッキリ', 'モニタリング', 'いたずら'] },
];

export type GenreSource = {
  title?: string | null;
  description?: string | null;
  channel_name?: string | null;
  content_type?: string | null;
};

/** 1コンテンツのジャンルを推定（該当なしはバラエティ／YouTube にフォールバック） */
export function inferGenre(c: GenreSource): string {
  const text = `${c.title ?? ''} ${c.description ?? ''} ${c.channel_name ?? ''}`;
  for (const rule of GENRE_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.key;
  }
  return c.content_type === 'youtube' ? 'YouTube' : 'バラエティ';
}
