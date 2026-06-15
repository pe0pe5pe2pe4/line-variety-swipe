'use client';
import { useEffect, useState } from 'react';

const KEY = 'font_scale';
const OPTIONS: { label: string; value: string }[] = [
  { label: '小', value: '90%' },
  { label: '中', value: '100%' },
  { label: '大', value: '115%' },
];

// フォントサイズ（rem基準）を設定から変更する。
export default function FontSizeSetting() {
  const [scale, setScale] = useState('100%');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) ?? '100%';
      setScale(saved);
      document.documentElement.style.fontSize = saved;
    } catch {
      // 無視
    }
  }, []);

  const apply = (v: string) => {
    setScale(v);
    try {
      localStorage.setItem(KEY, v);
      document.documentElement.style.fontSize = v;
    } catch {
      // 無視
    }
  };

  return (
    <div className="bg-slate-800/60 rounded-2xl p-4">
      <h2 className="text-white font-bold text-sm mb-3">🔠 文字サイズ</h2>
      <div className="flex gap-2" role="group" aria-label="文字サイズ設定">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => apply(o.value)}
            aria-label={`文字サイズ${o.label}`}
            aria-pressed={scale === o.value}
            className={`flex-1 py-2 rounded-full font-bold text-sm transition-colors ${
              scale === o.value ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-300'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
