'use client';
import { Content } from '@/lib/types';
import ContentImage from './ContentImage';

type Props = {
  items: Content[];
  onShowDetail: (content: Content) => void;
};

export default function WatchLaterList({ items, onShowDetail }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-center px-8 py-20">
        <span className="text-5xl mb-4">📋</span>
        <p className="text-white text-lg font-bold">リストは空です</p>
        <p className="text-slate-400 text-sm mt-2">右スワイプした番組がここに追加されます</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm mx-auto px-4 pb-4">
      {items.map((item) => {
        const isYoutube = item.content_type === 'youtube';
        const hasAffiliate = !!item.vod_affiliate_url?.trim();

        return (
          <button
            key={item.id}
            onClick={() => onShowDetail(item)}
            className="w-full flex items-center gap-3 p-3 mb-3 bg-slate-800/60 rounded-2xl text-left active:bg-slate-700/60 transition-colors"
          >
            {/* Thumbnail */}
            <div className="relative w-16 h-20 flex-shrink-0 rounded-xl overflow-hidden bg-slate-700">
              <ContentImage
                src={item.thumbnail_url}
                alt={item.title}
                channelName={item.channel_name}
                sizes="64px"
              />
              {isYoutube && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <span className="text-white text-lg">▶</span>
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm leading-tight line-clamp-2">{item.title}</p>
              {item.description ? (
                <p className="text-slate-400 text-xs mt-1 line-clamp-2">{item.description}</p>
              ) : null}
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {hasAffiliate && (
                  <span className="inline-block text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-bold">
                    ⭐ おすすめ
                  </span>
                )}
                {isYoutube && (
                  <span className="inline-block text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
                    YouTube
                  </span>
                )}
              </div>
            </div>

            {/* Chevron */}
            <span className="text-slate-500 text-sm flex-shrink-0">›</span>
          </button>
        );
      })}
    </div>
  );
}
