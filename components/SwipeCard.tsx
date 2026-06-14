'use client';
import { useRef } from 'react';
import { useSpring, animated } from '@react-spring/web';
import { useDrag } from '@use-gesture/react';

type Content = {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  vod_affiliate_url: string;
};

type Props = {
  content: Content;
  onSwipe: (direction: 'left' | 'right') => void;
  isTop: boolean;
};

const SWIPE_THRESHOLD = 100;

export default function SwipeCard({ content, onSwipe, isTop }: Props) {
  const [{ x, rotate, opacity }, api] = useSpring(() => ({
    x: 0,
    rotate: 0,
    opacity: 1,
    config: { tension: 300, friction: 30 },
  }));

  const gone = useRef(false);

  const bind = useDrag(
    ({ active, movement: [mx], velocity: [vx], direction: [dx] }) => {
      if (gone.current) return;

      const trigger = Math.abs(mx) > SWIPE_THRESHOLD || Math.abs(vx) > 0.5;

      if (!active && trigger) {
        gone.current = true;
        const dir = mx > 0 ? 1 : -1;
        api.start({
          x: dir * window.innerWidth * 1.5,
          rotate: dir * 30,
          opacity: 0,
          onRest: () => onSwipe(dir > 0 ? 'right' : 'left'),
        });
      } else if (!active) {
        api.start({ x: 0, rotate: 0, opacity: 1 });
      } else {
        api.start({
          x: mx,
          rotate: mx / 15,
          opacity: 1,
          immediate: true,
        });
      }
    },
    { filterTaps: true, pointer: { touch: true } }
  );

  const likeOpacity = x.to((v) => Math.max(0, Math.min(1, v / SWIPE_THRESHOLD)));
  const nopeOpacity = x.to((v) => Math.max(0, Math.min(1, -v / SWIPE_THRESHOLD)));

  return (
    <animated.div
      {...(isTop ? bind() : {})}
      style={{
        x,
        rotate,
        opacity,
        touchAction: 'none',
        position: 'absolute',
        inset: 0,
        cursor: isTop ? 'grab' : 'default',
        userSelect: 'none',
      }}
      className="will-change-transform"
    >
      <div className="w-full h-full bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Image */}
        <div className="relative flex-shrink-0 h-[60%] bg-gray-100">
          <img
            src={
              content.thumbnail_url &&
              content.thumbnail_url !== 'not_found' &&
              content.thumbnail_url !== 'no_image' &&
              !content.thumbnail_url.includes('placehold.co')
                ? content.thumbnail_url
                : 'https://placehold.co/400x600/1a1a2e/ffffff?text=No+Image'
            }
            alt={content.title}
            className="w-full h-full object-cover"
            draggable={false}
            loading="eager"
            fetchPriority={isTop ? 'high' : 'low'}
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

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
        </div>

        {/* Info */}
        <div className="flex flex-col flex-1 p-5 gap-2">
          <h2 className="text-xl font-bold text-gray-900 leading-tight line-clamp-2">{content.title}</h2>
          <p className="text-sm text-gray-500 line-clamp-3 flex-1">{content.description}</p>

          {/* Action buttons */}
          <div className="flex justify-center gap-8 pt-2">
            <button
              onPointerDown={(e) => { e.stopPropagation(); onSwipe('left'); }}
              className="w-14 h-14 flex items-center justify-center rounded-full border-2 border-rose-300 text-rose-400 text-2xl shadow-md hover:bg-rose-50 active:scale-95 transition-all"
              aria-label="Skip"
            >
              ✕
            </button>
            <button
              onPointerDown={(e) => { e.stopPropagation(); onSwipe('right'); }}
              className="w-14 h-14 flex items-center justify-center rounded-full border-2 border-emerald-300 text-emerald-500 text-2xl shadow-md hover:bg-emerald-50 active:scale-95 transition-all"
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
