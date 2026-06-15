'use client';
import { useRef } from 'react';
import { useSpring, animated } from '@react-spring/web';
import { useDrag } from '@use-gesture/react';
import { Content, getDisplayDescription, extractYouTubeId } from '@/lib/types';
import { inferGenre, genreColorClass } from '@/lib/genre';
import ContentImage from './ContentImage';
import ShareButton from './ShareButton';

type Props = {
  content: Content;
  onSwipe: (direction: 'left' | 'right' | 'up') => void;
  onShowDetail: () => void;
  isTop: boolean;
  featured?: boolean;
  // A/Bテスト: 'B' は「今すぐ見る」ボタンを常時大きく表示
  variant?: 'A' | 'B';
};

const SWIPE_THRESHOLD = 100;

export default function SwipeCard({ content, onSwipe, onShowDetail, isTop, featured, variant = 'A' }: Props) {
  const [{ x, y, rotate, opacity }, api] = useSpring(() => ({
    x: 0,
    y: 0,
    rotate: 0,
    opacity: 1,
    config: { tension: 300, friction: 30 },
  }));

  const gone = useRef(false);

  // ハプティクス：右=50ms / 上=100ms
  const haptic = (dir: 'left' | 'right' | 'up') => {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (dir === 'up') navigator.vibrate(100);
    else if (dir === 'right') navigator.vibrate(50);
  };

  const commit = (dir: 'left' | 'right' | 'up') => {
    haptic(dir);
    onSwipe(dir);
  };

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
        haptic('up');
        api.start({
          y: -(window.innerHeight * 1.5),
          opacity: 0,
          onRest: () => onSwipe('up'),
        });
      } else if (!active && horizTrigger && !isVertical) {
        gone.current = true;
        const dir = mx > 0 ? 1 : -1;
        haptic(dir > 0 ? 'right' : 'left');
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
  const isTver = content.content_type === 'tver';
  // 先頭カードはインライン動画プレビュー（ミュート自動再生）。
  // YouTube は本編、Tver/番組は検索で見つけた公式クリップ（'none'は画像のまま）。
  const ytId = extractYouTubeId(content.youtube_url) ?? extractYouTubeId(content.preview_youtube_url);
  const showVideo = isTop && !!ytId;
  const genre = content.genre ?? inferGenre(content);
  const station = content.channel_name?.trim();
  const meta = [content.episode_number, content.broadcast_date]
    .filter((v) => v && v !== 'unknown')
    .join(' • ');

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
      className="will-change-transform swipe-surface"
      role="group"
      aria-label={`番組カード: ${content.title}。左右上にスワイプ、または矢印キーで操作`}
      aria-roledescription="スワイプカード"
    >
      {/* TikTok風 縦型フルスクリーンカード：画像全面 + 下部グラデにテキスト */}
      <div className="relative w-full h-full rounded-3xl shadow-2xl overflow-hidden bg-black">
        {/* フルスクリーンサムネイル（object-cover）＝動画読込前のポスター */}
        <ContentImage
          src={content.thumbnail_url}
          alt={content.title}
          channelName={content.channel_name}
          eager={isTop}
        />

        {/* YouTube インライン動画プレビュー（先頭カードのみ・ミュート自動再生・
            pointer-events:none でスワイプ操作を阻害しない） */}
        {showVideo && (
          <iframe
            className="absolute inset-0 w-full h-full pointer-events-none"
            src={`https://www.youtube.com/embed/${ytId}?autoplay=1&mute=1&playsinline=1&controls=0&loop=1&playlist=${ytId}&rel=0&modestbranding=1&disablekb=1&fs=0`}
            title={content.title}
            allow="autoplay; encrypted-media"
            loading="eager"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}

        {/* 上下グラデーションオーバーレイ */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-black/40 pointer-events-none" />

        {/* バッジ（左上） */}
        {(featured || content.discovery || content.recommend_reason) && (
          <div className="absolute top-4 left-4 right-4 flex flex-wrap gap-2 pointer-events-none">
            {content.discovery ? (
              <span className="inline-block bg-fuchsia-500 text-white text-xs font-black px-3 py-1 rounded-full shadow">
                🔍 発掘 — まだ知られてない
              </span>
            ) : (
              <>
                {featured && (
                  <span className="inline-block bg-amber-400 text-black text-xs font-black px-3 py-1 rounded-full shadow">
                    ⭐ あなたへのおすすめ
                  </span>
                )}
                {content.recommend_reason && (
                  <span className="inline-block bg-indigo-500/85 text-white text-xs font-bold px-3 py-1 rounded-full backdrop-blur-sm">
                    💡 {content.recommend_reason}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* YouTube play icon（中央）＝動画プレビュー中は非表示 */}
        {isYoutube && !showVideo && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-20 h-20 flex items-center justify-center bg-red-600/80 rounded-full shadow-lg">
              <span className="text-white text-4xl ml-1">▶</span>
            </div>
          </div>
        )}

        {/* 動画プレビュー中のミュート表示（タップで詳細→全画面再生） */}
        {showVideo && (
          <div className="absolute top-4 right-4 bg-black/60 text-white text-xs font-bold px-2 py-1 rounded-full pointer-events-none">
            🔇 タップで再生
          </div>
        )}

        {/* LIKE badge（大） */}
        <animated.div
          style={{ opacity: likeOpacity }}
          className="absolute top-10 left-6 border-[6px] border-emerald-400 text-emerald-400 font-black text-5xl px-4 py-1.5 rounded-2xl rotate-[-20deg] tracking-widest pointer-events-none"
        >
          LIKE
        </animated.div>

        {/* NOPE badge（大） */}
        <animated.div
          style={{ opacity: nopeOpacity }}
          className="absolute top-10 right-6 border-[6px] border-rose-400 text-rose-400 font-black text-5xl px-4 py-1.5 rounded-2xl rotate-[20deg] tracking-widest pointer-events-none"
        >
          NOPE
        </animated.div>

        {/* NOW badge（上スワイプ・大） */}
        <animated.div
          style={{ opacity: nowOpacity }}
          className="absolute top-1/3 left-1/2 -translate-x-1/2 border-[6px] border-sky-400 text-sky-400 font-black text-4xl px-4 py-1.5 rounded-2xl tracking-widest whitespace-nowrap pointer-events-none"
        >
          今すぐ見る
        </animated.div>

        {/* 下部 情報オーバーレイ */}
        <div className="absolute inset-x-0 bottom-0 p-5 pb-6 flex flex-col gap-2">
          {/* ジャンル / 放送局タグ */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-black px-2.5 py-0.5 rounded-full ${genreColorClass(genre)}`}>
              #{genre}
            </span>
            {isYoutube ? (
              <span className="text-xs font-bold text-white bg-red-600 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <span className="text-[13px]">▶</span> YouTube
              </span>
            ) : isTver ? (
              <span className="text-xs font-black text-white bg-green-600 px-2.5 py-0.5 rounded-full">
                TVer
              </span>
            ) : (
              station && (
                <span className="text-xs font-bold text-white bg-white/20 px-2.5 py-0.5 rounded-full backdrop-blur-sm">
                  📺 {station}
                </span>
              )
            )}
          </div>

          {/* 番組名（大・白・太字） */}
          <h2 className="text-white text-3xl font-black leading-tight line-clamp-2 drop-shadow-lg">
            {content.title}
          </h2>

          {/* チャンネル名（YouTube）/ 放送回・日付 */}
          {isYoutube && station ? (
            <p className="text-slate-200 text-sm font-medium truncate">{station}</p>
          ) : meta ? (
            <p className="text-slate-200 text-xs truncate">{meta}</p>
          ) : null}

          {getDisplayDescription(content) ? (
            <p className="text-slate-300 text-sm line-clamp-2">{getDisplayDescription(content)}</p>
          ) : null}

          {/* A/Bテスト B群：常時表示の「今すぐ見る」ボタン */}
          {variant === 'B' && (
            <button
              onPointerDown={(e) => { e.stopPropagation(); commit('up'); }}
              aria-label="今すぐ見る"
              className="mt-1 w-full py-3 bg-sky-500 text-white rounded-full font-black text-base shadow-lg active:scale-95 transition-transform"
            >
              ▶ 今すぐ見る
            </button>
          )}

          {/* Action buttons */}
          <div className="flex justify-center items-center gap-6 pt-2">
            {/* NOPE */}
            <button
              onPointerDown={(e) => { e.stopPropagation(); commit('left'); }}
              className="w-[56px] h-[56px] flex items-center justify-center rounded-full bg-white/90 text-rose-500 text-2xl shadow-lg active:scale-90 transition-transform"
              aria-label="Skip"
            >
              ✕
            </button>

            {/* NOW（上スワイプ = 今すぐ見る） */}
            <button
              onPointerDown={(e) => { e.stopPropagation(); commit('up'); }}
              className="w-[48px] h-[48px] flex items-center justify-center rounded-full bg-sky-500 text-white text-lg shadow-lg active:scale-90 transition-transform"
              aria-label="Watch Now"
            >
              ▶
            </button>

            {/* LIKE（あとで見る） */}
            <button
              onPointerDown={(e) => { e.stopPropagation(); commit('right'); }}
              className="w-[56px] h-[56px] flex items-center justify-center rounded-full bg-emerald-500 text-white text-2xl shadow-lg active:scale-90 transition-transform"
              aria-label="Like"
            >
              ♥
            </button>

            {/* SHARE（シェア） */}
            <ShareButton content={content} />
          </div>
        </div>
      </div>
    </animated.div>
  );
}
