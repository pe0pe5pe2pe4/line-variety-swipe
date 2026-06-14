export type ContentType = 'tv_show' | 'youtube';

export type Content = {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  vod_affiliate_url: string;
  content_type?: ContentType;
  youtube_url?: string;
  channel_name?: string;
  episode_number?: string;
  episode_title?: string;
  broadcast_date?: string;
};

const PLACEHOLDER_IMG = 'https://placehold.co/400x600/1a1a2e/ffffff?text=No+Image';

/** サムネイルとして利用可能な実画像URLがあるか判定 */
export function hasValidThumbnail(url: string | undefined | null): boolean {
  if (!url) return false;
  if (url === 'not_found' || url === 'no_image') return false;
  if (url.includes('placehold.co')) return false;
  return /^https?:\/\//.test(url);
}

export function getThumbnailSrc(url: string | undefined | null): string {
  if (!hasValidThumbnail(url)) return PLACEHOLDER_IMG;
  return url as string;
}
