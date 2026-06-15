'use client';
import { Content } from '@/lib/types';

type Props = {
  content: Content;
  className?: string;
};

/** 番組カードのシェアボタン。Web Share API → 無ければ LINE 共有にフォールバック */
export default function ShareButton({ content, className }: Props) {
  const buildShareText = () => {
    // 番組詳細ページ(/show/[id])を共有 → OGPに番組サムネイルが表示される
    const base =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    const url = base ? `${base}/show/${content.id}` : '';
    // アフィリエイトリンクがあればシェアテキストにも含める（収益最大化）
    const affiliate = content.vod_affiliate_url?.trim();
    const affiliateLine = affiliate ? `\n▶ 視聴はこちら: ${affiliate}` : '';
    return `「${content.title}」が気になってる🎬\nバラ推しで発見したよ！\nあなたのおすすめは？${affiliateLine}\n${url}`;
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = buildShareText();

    // LINE 環境では shareTargetPicker で友達に直接シェア
    try {
      const { shareViaLiff } = await import('@/lib/liff');
      if (await shareViaLiff(text)) return;
    } catch {
      // フォールバックへ
    }

    // Web Share API（LINEを含む各SNSのネイティブ共有シートを表示）
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'バラ推し', text });
      } catch {
        // ユーザーがキャンセルした場合は何もしない
      }
      return;
    }

    // フォールバック：LINE 共有ダイアログ
    const lineUrl = `https://line.me/R/share?text=${encodeURIComponent(text)}`;
    window.open(lineUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handleShare}
      className={
        className ??
        'w-[48px] h-[48px] flex items-center justify-center rounded-full bg-white/90 text-slate-700 text-xl shadow-lg active:scale-90 transition-transform'
      }
      aria-label="シェア"
    >
      ↗
    </button>
  );
}
