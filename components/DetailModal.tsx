'use client';
import { Content } from '@/lib/types';
import ContentImage from './ContentImage';

type Props = {
  content: Content | null;
  onClose: () => void;
};

export default function DetailModal({ content, onClose }: Props) {
  if (!content) return null;

  const isYoutube = content.content_type === 'youtube';

  // ① TVer（常に表示）
  const tverUrl = `https://tver.jp/search/#${encodeURIComponent(content.title)}`;

  // ② YouTube（content_type === 'youtube' のみ）
  const youtubeUrl = content.youtube_url
    ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(content.title)}`;

  // ③ ABEMA（常に表示）
  const abemaUrl = `https://abema.tv/search?q=${encodeURIComponent(content.title)}`;

  // ④⑤⑥ U-NEXT / Hulu / Amazon（vod_affiliate_urlが設定されている場合のみ）
  // 現時点は空なので非表示。後からアフィリエイトリンクを差し込むと自動表示される
  const affiliateUrl = content.vod_affiliate_url?.trim() ?? '';
  const hasAffiliate = affiliateUrl.length > 0;

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
            {content.description ? (
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">{content.description}</p>
            ) : null}

            {/* Platform buttons */}
            <div className="flex flex-col gap-3 mt-5 pb-6">

              {/* ① TVer（常に表示・無料コンテンツ最優先） */}
              <a
                href={tverUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-3.5 bg-blue-500 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
              >
                <span>📺</span> TVer で見る（無料）
              </a>

              {/* ② YouTube（youtube コンテンツのみ） */}
              {isYoutube && (
                <a
                  href={youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-3.5 bg-red-500 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
                >
                  <span className="text-lg">▶</span> YouTube で見る（無料）
                </a>
              )}

              {/* ③ ABEMA（常に表示・無料コンテンツ多数） */}
              <a
                href={abemaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 py-3.5 bg-cyan-500 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
              >
                <span>📡</span> ABEMA で見る（一部無料）
              </a>

              {/* ④ U-NEXT（アフィリエイトリンクが設定された場合のみ） */}
              {hasAffiliate && (
                <a
                  href={affiliateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-3.5 bg-purple-600 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
                >
                  <span>🎬</span> U-NEXT で見る
                </a>
              )}

              {/* ⑤ Hulu・⑥ Amazon Prime は個別カラムが追加されたら表示 */}
              {/* Netflix はアフィリエイトプログラムなし → 非表示 */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
