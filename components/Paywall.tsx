'use client';
import { useState } from 'react';
import { PREMIUM_PRICE_JPY } from '@/lib/premium';

type Props = {
  userId: string | null;
  onUpgraded: () => void;
  title?: string;
};

// スワイプ上限到達／プレミアム訴求のオーバーレイ
export default function Paywall({ userId, onUpgraded, title = '今日のスワイプ上限に達しました' }: Props) {
  const [loading, setLoading] = useState(false);

  const upgrade = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      // Stripe Checkout へ
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      // Stripe 未設定時はモックでプレミアム付与にフォールバック
      const mock = await fetch('/api/upgrade-premium', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });
      if (mock.ok) onUpgraded();
    } catch {
      // 失敗時は何もしない
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm px-6">
      <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-3xl p-6 text-center">
        <div className="text-5xl mb-3">🔍</div>
        <h2 className="text-white text-lg font-black">{title}</h2>
        <p className="text-slate-400 text-sm mt-2">
          プレミアムなら<strong className="text-white">無制限で発掘</strong>。地下芸人・深夜番組・
          まだ知られていない名作を、止まらずに掘り続けられます。あとで見るも無制限。
        </p>
        <button
          onClick={upgrade}
          disabled={loading}
          className="mt-5 w-full py-3.5 bg-gradient-to-r from-amber-400 to-orange-500 text-black rounded-full font-black text-base active:scale-95 transition-transform disabled:opacity-60"
        >
          {loading ? '処理中...' : `プレミアムにアップグレード（月額${PREMIUM_PRICE_JPY}円）`}
        </button>
        <p className="text-slate-500 text-xs mt-3">また明日になれば無料で続けられます</p>
      </div>
    </div>
  );
}
