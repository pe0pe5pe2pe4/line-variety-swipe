'use client';
import { useEffect, useState } from 'react';

const HINTS_KEY = 'swipe_hints_seen';

// 初回起動時のみ表示する操作説明のツールチップ（タップで閉じる）
export default function SwipeHints() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(HINTS_KEY) !== '1') setShow(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(HINTS_KEY, '1');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      onClick={dismiss}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-6 text-center px-8">
        <div className="flex items-center gap-3 animate-pulse">
          <span className="text-4xl">👆</span>
          <div className="text-left">
            <p className="text-sky-300 font-black text-lg">上スワイプ</p>
            <p className="text-white text-sm">今すぐ見る</p>
          </div>
        </div>
        <div className="flex items-center gap-10">
          <div className="flex flex-col items-center animate-pulse">
            <span className="text-4xl">👈</span>
            <p className="text-rose-300 font-black mt-1">左</p>
            <p className="text-white text-xs">興味なし</p>
          </div>
          <div className="flex flex-col items-center animate-pulse">
            <span className="text-4xl">👉</span>
            <p className="text-emerald-300 font-black mt-1">右</p>
            <p className="text-white text-xs">あとで見る</p>
          </div>
        </div>
        <p className="text-slate-300 text-sm mt-4">タップして始める</p>
      </div>
    </div>
  );
}
