'use client';
import { Content, getThumbnailSrc } from '@/lib/types';

type Props = {
  content: Content | null;
  onClose: () => void;
};

export default function DetailModal({ content, onClose }: Props) {
  if (!content) return null;

  const isYoutube = content.content_type === 'youtube';
  const thumbnailSrc = getThumbnailSrc(content.thumbnail_url);

  const tverUrl = `https://tver.jp/search/#${encodeURIComponent(content.title)}`;
  const youtubeUrl = content.youtube_url
    ?? `https://www.youtube.com/results?search_query=${encodeURIComponent(content.title)}`;

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
            <img
              src={thumbnailSrc}
              alt={content.title}
              className="w-full h-full object-cover"
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
            {content.description ? (
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">{content.description}</p>
            ) : null}

            {/* Platform buttons */}
            <div className="flex flex-col gap-3 mt-5 pb-6">
              {isYoutube ? (
                <a
                  href={youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-3.5 bg-red-500 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
                >
                  <span className="text-lg">▶</span> YouTubeで見る
                </a>
              ) : (
                <>
                  <a
                    href={tverUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 py-3.5 bg-blue-500 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
                  >
                    <span>📺</span> TVer で見る
                  </a>
                  <a
                    href={`https://video.unext.jp/search?query=${encodeURIComponent(content.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 py-3.5 bg-purple-600 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
                  >
                    <span>🎬</span> U-NEXT で見る
                  </a>
                  <a
                    href={`https://www.hulu.jp/search?q=${encodeURIComponent(content.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 py-3.5 bg-green-500 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
                  >
                    <span>🎥</span> Hulu で見る
                  </a>
                  <a
                    href={`https://abema.tv/search?q=${encodeURIComponent(content.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 py-3.5 bg-cyan-500 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
                  >
                    <span>📡</span> ABEMA で見る
                  </a>
                  <a
                    href={`https://www.amazon.co.jp/s?k=${encodeURIComponent(content.title)}&i=prime-instant-video`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 py-3.5 bg-orange-400 text-white rounded-2xl font-bold text-sm active:opacity-80 transition-opacity"
                  >
                    <span>🛒</span> Amazon Prime で見る
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
