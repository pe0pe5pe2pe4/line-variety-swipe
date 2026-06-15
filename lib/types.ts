export type ContentType = 'tv_show' | 'youtube' | 'tver';

export type Content = {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  vod_affiliate_url: string;
  content_type?: ContentType;
  youtube_url?: string;
  tver_url?: string;
  // Tver/番組カード用に検索で見つけた公式YouTube動画（無ければ画像にフォールバック）
  preview_youtube_url?: string | null;
  channel_name?: string;
  episode_number?: string;
  episode_title?: string;
  broadcast_date?: string;
  // Claude API で加工した紹介文（あれば description より優先表示）
  enriched_description?: string;
  // 推定ジャンル（recommend APIが付与）
  genre?: string;
  // 推薦理由（recommend APIが付与・カードに小さく表示）
  recommend_reason?: string;
  // 出演者（Wikipedia取得・詳細モーダルに表示）
  cast_names?: string[] | null;
  // クリック数（view_count）
  view_count?: number;
  // コンテンツ品質スコア（0-1）
  quality_score?: number | null;
  created_at?: string | null;
  // YouTube実再生数（発掘のミドル帯=数万〜数十万 を選ぶのに使用）
  yt_view_count?: number | null;
  // 発掘枠（露出の少ない＝まだ知られていない候補）か
  discovery?: boolean;
};

// YouTube の各種URL形式から動画IDを取り出す（watch?v= / youtu.be/ / embed/ 等）
export function extractYouTubeId(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

const PLACEHOLDER_IMG = 'https://placehold.co/400x600/1a1a2e/ffffff?text=No+Image';

/** サムネイルとして利用可能な実画像URLがあるか判定 */
export function hasValidThumbnail(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url === 'not_found' || url === 'no_image') return false;
  if (url.includes('placehold.co')) return false;
  return /^https?:\/\//.test(url);
}

/** カード表示用の説明文（加工済みがあれば優先、無ければ元の説明） */
export function getDisplayDescription(c: Pick<Content, 'enriched_description' | 'description'>): string {
  const enriched = c.enriched_description?.trim();
  return enriched || c.description || '';
}

export function getThumbnailSrc(url: string | undefined | null): string {
  if (!hasValidThumbnail(url)) return PLACEHOLDER_IMG;
  return url as string;
}
