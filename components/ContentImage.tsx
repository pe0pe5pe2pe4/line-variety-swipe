'use client';
import Image from 'next/image';
import { hasValidThumbnail } from '@/lib/types';

type Props = {
  src?: string | null;
  alt: string;
  /** 画像が無い場合にプレースホルダー中央へ表示する局名など */
  channelName?: string;
  sizes?: string;
  /** 先頭カードなど即時読み込みしたい場合 true（それ以外は遅延読み込み） */
  eager?: boolean;
};

/**
 * カード／リスト共通の画像コンポーネント。
 * - 親要素は position: relative（fill のため）と固定サイズを持つこと
 * - object-cover で余白・引き伸ばしを防ぎ、全カードで見た目を統一
 * - 画像が無い番組は局名 or 「No Image」を中央に表示する統一プレースホルダー
 */
export default function ContentImage({
  src,
  alt,
  channelName,
  sizes = '(max-width: 480px) 100vw, 400px',
  eager = false,
}: Props) {
  if (!hasValidThumbnail(src)) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900">
        <span className="px-3 text-center text-slate-300 text-sm font-bold line-clamp-3">
          {channelName?.trim() || 'No Image'}
        </span>
      </div>
    );
  }

  return (
    <Image
      src={src as string}
      alt={alt}
      fill
      sizes={sizes}
      className="object-cover"
      draggable={false}
      loading={eager ? 'eager' : 'lazy'}
    />
  );
}
