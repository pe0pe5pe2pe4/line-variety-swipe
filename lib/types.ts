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

export function getThumbnailSrc(url: string | undefined | null): string {
  if (!url) return 'https://placehold.co/400x600/1a1a2e/ffffff?text=No+Image';
  if (url === 'not_found' || url === 'no_image') return 'https://placehold.co/400x600/1a1a2e/ffffff?text=No+Image';
  if (url.includes('placehold.co')) return 'https://placehold.co/400x600/1a1a2e/ffffff?text=No+Image';
  return url;
}
