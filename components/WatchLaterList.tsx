'use client';
import { useMemo, useState } from 'react';
import { Content } from '@/lib/types';
import { resolveGenre } from '@/lib/genre';
import ContentImage from './ContentImage';

type Props = {
  items: Content[];
  onShowDetail: (content: Content) => void;
  onWatchNow: (content: Content) => void;
  onRemove: (content: Content) => void;
};

export default function WatchLaterList({ items, onShowDetail, onWatchNow, onRemove }: Props) {
  const [genreFilter, setGenreFilter] = useState<string>('すべて');

  // 表示中のジャンル一覧
  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) set.add(resolveGenre(it));
    return ['すべて', ...[...set].sort()];
  }, [items]);

  const filtered = useMemo(
    () => (genreFilter === 'すべて' ? items : items.filter((it) => resolveGenre(it) === genreFilter)),
    [items, genreFilter]
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-center px-8 py-20">
        <span className="text-5xl mb-4">📋</span>
        <p className="text-white text-lg font-bold">リストは空です</p>
        <p className="text-slate-400 text-sm mt-2">右スワイプした番組がここに表示されます</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm mx-auto px-4 pb-4">
      {/* ジャンル別フィルタ */}
      {genres.length > 2 && (
        <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1">
          {genres.map((g) => (
            <button
              key={g}
              onClick={() => setGenreFilter(g)}
              className={`whitespace-nowrap text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${
                genreFilter === g ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-300'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {filtered.map((item) => {
        const isYoutube = item.content_type === 'youtube';
        const hasAffiliate = !!item.vod_affiliate_url?.trim();

        return (
          <div
            key={item.id}
            className="w-full flex items-center gap-3 p-3 mb-3 bg-slate-800/60 rounded-2xl"
          >
            {/* Thumbnail（タップで詳細） */}
            <button
              onClick={() => onShowDetail(item)}
              className="relative w-16 h-20 flex-shrink-0 rounded-xl overflow-hidden bg-slate-700"
            >
              <ContentImage src={item.thumbnail_url} alt={item.title} channelName={item.channel_name} sizes="64px" />
              {isYoutube && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <span className="text-white text-lg">▶</span>
                </div>
              )}
            </button>

            {/* Info */}
            <button onClick={() => onShowDetail(item)} className="flex-1 min-w-0 text-left">
              <p className="text-white font-bold text-sm leading-tight line-clamp-2">{item.title}</p>
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
            </button>

            {/* Actions */}
            <div className="flex flex-col gap-2 flex-shrink-0">
              <button
                onClick={() => onWatchNow(item)}
                className="px-3 py-1.5 bg-sky-500 text-white rounded-full text-xs font-bold active:scale-95 transition-transform"
              >
                今すぐ見る
              </button>
              <button
                onClick={() => onRemove(item)}
                className="px-3 py-1.5 bg-slate-700 text-slate-300 rounded-full text-xs active:scale-95 transition-transform"
              >
                削除
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
