'use client';
import { useRef } from 'react';
import { useSpring, animated } from '@react-spring/web';
import { useDrag } from '@use-gesture/react';
import { Content, getThumbnailSrc } from '@/lib/types';

type Props = {
  content: Content;
  onSwipe: (direction: 'left' | 'right' | 'up') => void;
  onShowDetail: () => void;
  isTop: boolean;
};

const SWIPE_THRESHOLD = 100;

export default function SwipeCard({ content, onSwipe, onShowDetail, isTop }: Props) {
  const [{ x, y, rotate, opacity }, api] = useSpring(() => ({
    x: 0,
    y: 0,
    rotate: 0,
    opacity: 1,
    config: { tension: 300, friction: 30 },
  }));

  const gone = useRef(false);

  // filterTaps:false → tap イベントも callback に届く（tap:true で判定）
  const bind = useDrag(
    ({ active, movement: [mx, my], velocity: [vx, vy], tap }) => {
      if (gone.current) return;

      // タップ → モーダル表示
      if (tap) {
        onShowDetail();
        return;
      }

      const horizTrigger = Math.abs(mx) > SWIPE_THRESHOLD || Math.abs(vx) > 0.5;
      // 上スワイプ：y が負方向（上）に閾値超え、かつ水平より垂直が優勢
      const upTrigger = my < -SWIPE_THRESHOLD || vy < -0.5;
      const isVertical = Math.abs(my) > Math.abs(mx);

      if (!active && upTrigger && isVertical) {
        gone.current = true;
        api.start({
          y: -(window.innerHeight * 1.5),
          opacity: 0,
          onRest: () => onSwipe('up'),
        });
      } else if (!active && horizTrigger && !isVertical) {
        gone.current = true;
        const dir = mx > 0 ? 1 : -1;
        api.start({
          x: dir * window.innerWidth * 1.5,
          rotate: dir * 30,
          opacity: 0,
          onRest: () => onSwipe(dir > 0 ? 'right' : 'left'),
        });
      } else if (!active) {
        api.start({ x: 0, y: 0, rotate: 0, opacity: 1 });
      } else {
        api.start({ x: mx, y: my, rotate: mx / 15, opacity: 1, immediate: true });
      }
    },
    { filterTaps: false, pointer: { touch: true } }
  );

  const likeOpacity = x.to((v) => Math.max(0, Math.min(1, v / SWIPE_THRESHOLD)));
  const nopeOpacity = x.to((v) => Math.max(0, Math.min(1, -v / SWIPE_THRESHOLD)));
  // 上スワイプ時（y が負）に NOW バッジを表示
  const nowOpacity  = y.to((v) => Math.max(0, Math.min(1, -v / SWIPE_THRESHOLD)));

  const isYoutube = content.content_type === 'youtube';
  const thumbnailSrc = getThumbnailSrc(content.thumbnail_url);

  return (
    <animated.div
      {...(isTop ? bind() : {})}
      style={{
        x,
        y,
        rotate,
        opacity,
        touchAction: 'none',
        position: 'absolute',
        inset: 0,
        cursor: isTop ? 'grab' : 'default',
        userSelect: 'none',
      }}
      // 長押し：モバイルで contextmenu イベントが発火する
      onContextMenu={(e) => { e.preventDefault(); if (isTop && !gone.current) onShowDetail(); }}
      className="will-change-transform"
    >
      <div className="w-full h-full bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Image */}
        <div className="relative flex-shrink-0 h-[60%] bg-gray-100">
          <img
            src={thumbnailSrc}
            alt={content.title}
            className="w-full h-full object-cover"
            draggable={false}
            loading="eager"
            fetchPriority={isTop ? 'high' : 'low'}
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

          {/* YouTube play icon */}
          {isYoutube && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-16 h-16 flex items-center justify-center bg-red-600/80 rounded-full">
                <span className="text-white text-3xl ml-1">▶</span>
              </div>
            </div>
          )}

          {/* LIKE badge */}
          <animated.div
            style={{ opacity: likeOpacity }}
            className="absolute top-6 left-6 border-4 border-emerald-400 text-emerald-400 font-black text-3xl px-3 py-1 rounded-xl rotate-[-20deg] tracking-widest"
          >
            LIKE
          </animated.div>

          {/* NOPE badge */}
          <animated.div
            style={{ opacity: nopeOpacity }}
            className="absolute top-6 right-6 border-4 border-rose-400 text-rose-400 font-black text-3xl px-3 py-1 rounded-xl rotate-[20deg] tracking-widest"
          >
            NOPE
          </animated.div>

          {/* NOW badge (上スワイプ) */}
          <animated.div
            style={{ opacity: nowOpacity }}
            className="absolute top-6 left-1/2 -translate-x-1/2 border-4 border-sky-400 text-sky-400 font-black text-2xl px-3 py-1 rounded-xl tracking-widest whitespace-nowrap"
          >
            今すぐ見る
          </animated.div>
        </div>

        {/* Info */}
        <div className="flex flex-col flex-1 p-4 gap-1.5">
          <h2 className="text-xl font-bold text-gray-900 leading-tight line-clamp-2">{content.title}</h2>
          {(content.episode_number || (content.broadcast_date && content.broadcast_date !== 'unknown')) && (
            <p className="text-xs text-indigo-400 truncate">
              {[content.episode_number, content.broadcast_date].filter(
                (v) => v && v !== 'unknown'
              ).join(' • ')}
            </p>
          )}
          <p className="text-sm text-gray-500 line-clamp-2 flex-1">{content.description}</p>

          {/* Action buttons */}
          <div className="flex justify-center items-center gap-5 pt-1">
            {/* NOPE */}
            <button
              onPointerDown={(e) => { e.stopPropagation(); onSwipe('left'); }}
              className="w-13 h-13 w-[52px] h-[52px] flex items-center justify-center rounded-full border-2 border-rose-300 text-rose-400 text-2xl shadow-md hover:bg-rose-50 active:scale-95 transition-all"
              aria-label="Skip"
            >
              ✕
            </button>

            {/* NOW (上スワイプ = 今すぐ見る) */}
            <button
              onPointerDown={(e) => { e.stopPropagation(); onSwipe('up'); }}
              className="w-[44px] h-[44px] flex items-center justify-center rounded-full border-2 border-sky-300 text-sky-400 text-lg shadow-md hover:bg-sky-50 active:scale-95 transition-all"
              aria-label="Watch Now"
            >
              ▶
            </button>

            {/* LIKE (あとで見る) */}
            <button
              onPointerDown={(e) => { e.stopPropagation(); onSwipe('right'); }}
              className="w-[52px] h-[52px] flex items-center justify-center rounded-full border-2 border-emerald-300 text-emerald-500 text-2xl shadow-md hover:bg-emerald-50 active:scale-95 transition-all"
              aria-label="Like"
            >
              ♥
            </button>
          </div>
        </div>
      </div>
    </animated.div>
  );
}
