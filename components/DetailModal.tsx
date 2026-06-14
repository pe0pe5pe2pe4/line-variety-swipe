'use client';
import { Content, getDisplayDescription } from '@/lib/types';
import { unextAffiliateUrl, trackClick } from '@/lib/affiliate';
import ContentImage from './ContentImage';

type Props = {
  content: Content | null;
  userId?: string | null;
  onClose: () => void;
};

export default function DetailModal({ content, userId, onClose }: Props) {
  if (!content) return null;

  const isYoutube = content.content_type === 'youtube';
  const track = (service: string) => trackClick({ userId, contentId: content.id, service });

  // 「探す」系リンク（番組名で各サービスを検索・Tver番組は直接リンク）
  const tverUrl = content.content_type === 'tver' && content.tver_url
    ? content.tver_url
    : `https://tver.jp/search/#${encodeURIComponent(content.title)}`;
  const abemaUrl = `https://abema.tv/search?q=${encodeURIComponent(content.title)}`;
  // YouTube: youtube動画なら直接URL、それ以外は検索
  const youtubeUrl = isYoutube && content.youtube_url
    ? content.youtube_url
    : `https://www.youtube.com/results?search_query=${encodeURIComponent(content.title)}`;

  // U-NEXT：vod_affiliate_url 優先、無ければアフィリエイトIDから動的生成（TASK4）
  const unextUrl = unextAffiliateUrl(content.title, content.vod_affiliate_url);
  const hasUnext = !!unextUrl;
  // Hulu：明示的な vod_affiliate_url がある場合のみ（Netflixは永久に非表示）
  const huluUrl = content.vod_affiliate_url?.trim() ?? '';
  const hasHulu = huluUrl.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      onPointerDown={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        className="relative w-full max-w-sm bg-white rounded-t-3xl overflow-hidden"
        style={{ maxHeight: '85dvh' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(85dvh - 24px)' }}>
          {/* Thumbnail */}
          <div className="relative h-48 bg-gray-100 mx-4 mt-2 rounded-2xl overflow-hidden">
            <ContentImage
              src={content.thumbnail_url}
              alt={content.title}
              channelName={content.channel_name}
              eager
            />
            {isYoutube && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-14 h-14 flex items-center justify-center bg-red-600/90 rounded-full">
                  <span className="text-white text-2xl ml-1">▶</span>
                </div>
              </div>
            )}
          </div>

          {/* Info */}
          <div className="px-5 py-4">
            <h2 className="text-xl font-bold text-gray-900 leading-tight">{content.title}</h2>
            {content.channel_name && (
              <p className="text-xs text-slate-400 mt-1">{content.channel_name}</p>
            )}
            {(content.episode_number || (content.broadcast_date && content.broadcast_date !== 'unknown')) && (
              <p className="text-xs text-indigo-500 mt-1">
                {[content.episode_number, content.broadcast_date].filter(
                  (v) => v && v !== 'unknown'
                ).join(' • ')}
              </p>
            )}
            {getDisplayDescription(content) ? (
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">{getDisplayDescription(content)}</p>
            ) : null}

            {content.cast_names && content.cast_names.length > 0 && (
              <p className="text-xs text-gray-500 mt-2">
                <span className="font-bold text-gray-700">出演：</span>
                {content.cast_names.join('、')}
              </p>
            )}

            {/* Platform buttons：すべて「○○で探す」に統一 */}
            <div className="flex flex-col gap-3 mt-5 pb-6">

              {/* U-NEXT（収益化のため最上部・動的アフィリエイト生成対応） */}
              {hasUnext && (
                <a
                  href={unextUrl!}
                  onClick={() => track('unext')}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="flex items-center justify-center gap-2 py-3.5 bg-purple-600 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
                >
                  <span>🎬</span> U-NEXTで探す
                </a>
              )}
              {/* Hulu（明示的な vod_affiliate_url がある場合のみ・Netflixは永久非表示） */}
              {hasHulu && (
                <a
                  href={huluUrl}
                  onClick={() => track('hulu')}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  className="flex items-center justify-center gap-2 py-3.5 bg-emerald-600 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
                >
                  <span>🟢</span> Huluで探す
                </a>
              )}

              {/* TVer（常に表示） */}
              <a
                href={tverUrl}
                onClick={() => track('tver')}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-3.5 bg-blue-500 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
              >
                <span>📺</span> TVerで探す
              </a>

              {/* ABEMA（常に表示） */}
              <a
                href={abemaUrl}
                onClick={() => track('abema')}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-3.5 bg-cyan-500 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
              >
                <span>📡</span> ABEMAで探す
              </a>

              {/* YouTube（常に表示・youtube動画は直接URLへ） */}
              <a
                href={youtubeUrl}
                onClick={() => track('youtube')}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-3.5 bg-red-500 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
              >
                <span className="text-lg">▶</span> YouTubeで探す
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
