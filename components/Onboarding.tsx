'use client';
import { useState, useEffect } from 'react';
import SwipeCard from './SwipeCard';
import { Content } from '@/lib/types';

const ONBOARDING_KEY = 'onboarding_done';
const ONBOARDING_COUNT = 20;

type Props = {
  userId: string;
  onComplete: () => void;
};

type Phase = 'intro' | 'swiping' | 'finishing';

const GUIDE = [
  { dir: '右', icon: '👉', label: '好き', color: 'text-emerald-400', delay: '0ms' },
  { dir: '上', icon: '👆', label: '今すぐ見たい', color: 'text-sky-400', delay: '120ms' },
  { dir: '左', icon: '👈', label: '興味なし', color: 'text-rose-400', delay: '240ms' },
];

export default function Onboarding({ userId, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [contents, setContents] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [swiped, setSwiped] = useState(0);

  // intro 表示中に裏でフィード候補を取得しておく
  useEffect(() => {
    fetch(`/api/recommend?user_id=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        const items = Array.isArray(data) ? data.slice(0, ONBOARDING_COUNT) : [];
        setContents(items);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId]);

  const finish = () => {
    setPhase('finishing');
    // 「フィードを作成中...」を一瞬挟んでからメインへ
    window.setTimeout(() => {
      localStorage.setItem(ONBOARDING_KEY, '1');
      onComplete();
    }, 1600);
  };

  const handleSwipe = (direction: 'left' | 'right' | 'up', content: Content) => {
    const next = contents.filter((c) => c.id !== content.id);
    const newSwiped = swiped + 1;
    setSwiped(newSwiped);
    setContents(next);

    // オンボーディング中のスワイプもログに記録（レコメンド精度向上のため）
    fetch('/api/swipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, content_id: content.id, direction }),
    }).catch(() => {});

    if (next.length === 0 || newSwiped >= ONBOARDING_COUNT) {
      finish();
    }
  };

  const handleSkip = () => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    onComplete();
  };

  // ── フィード作成中 ──
  if (phase === 'finishing') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 px-4">
        <div className="w-14 h-14 rounded-full border-4 border-indigo-400 border-t-transparent animate-spin" />
        <p className="mt-6 text-white text-lg font-bold">フィードを作成中...</p>
        <p className="mt-2 text-slate-400 text-sm">あなた好みの番組を集めています</p>
      </div>
    );
  }

  // ── 説明画面（イントロ） ──
  if (phase === 'intro') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 px-6">
        <div className="w-full max-w-sm text-center">
          <div className="text-6xl mb-4 animate-bounce">🎬</div>
          <h1 className="text-white text-3xl font-black tracking-tight leading-snug">バラ推し</h1>
          <p className="text-slate-300 text-base mt-3 leading-relaxed">
            好きな番組をスワイプして、<br />あなただけのフィードを作ろう
          </p>

          {/* スワイプ操作の説明（アニメーション付き） */}
          <div className="mt-8 flex flex-col gap-3">
            {GUIDE.map((g) => (
              <div
                key={g.dir}
                className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-2xl px-5 py-3 animate-fade-in-up"
                style={{ animationDelay: g.delay }}
              >
                <span className="text-3xl animate-pulse">{g.icon}</span>
                <div className="text-left">
                  <p className={`font-black ${g.color}`}>{g.dir}にスワイプ</p>
                  <p className="text-slate-400 text-sm">{g.label}</p>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={() => setPhase('swiping')}
            disabled={loading && contents.length === 0}
            className="mt-9 w-full py-4 bg-indigo-500 text-white rounded-full font-black text-lg shadow-lg hover:bg-indigo-400 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading && contents.length === 0 ? '読み込み中...' : 'はじめる'}
          </button>
          <button
            onClick={handleSkip}
            className="mt-4 text-slate-400 text-sm underline hover:text-white transition-colors"
          >
            スキップ
          </button>
        </div>
      </div>
    );
  }

  // ── スワイプ画面 ──
  const remaining = Math.max(ONBOARDING_COUNT - swiped, 0);
  const progress = Math.min((swiped / ONBOARDING_COUNT) * 100, 100);
  const visibleCards = contents.slice(0, 3);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 px-4">
      {/* Header */}
      <div className="w-full max-w-sm mb-3 text-center">
        <h1 className="text-white text-xl font-black tracking-tight">好きな番組を選んでください</h1>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-sm mb-5">
        <div className="flex justify-between items-end text-slate-300 text-xs mb-1">
          <span className="font-bold text-indigo-300">あと {remaining} 本</span>
          <button onClick={handleSkip} className="underline hover:text-white transition-colors">
            スキップ
          </button>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-2">
          <div
            className="bg-indigo-400 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Card stack */}
      {loading ? (
        <div className="flex items-center justify-center" style={{ height: 'min(640px, calc(100dvh - 200px))' }}>
          <div className="w-10 h-10 rounded-full border-4 border-indigo-400 border-t-transparent animate-spin" />
        </div>
      ) : contents.length === 0 ? (
        <div className="text-center">
          <p className="text-white text-lg font-bold">完了！</p>
          <button
            onClick={finish}
            className="mt-4 px-6 py-3 bg-indigo-500 text-white rounded-full font-bold hover:bg-indigo-400 transition-colors"
          >
            メイン画面へ
          </button>
        </div>
      ) : (
        <div className="relative w-full max-w-sm" style={{ height: 'min(640px, calc(100dvh - 200px))' }}>
          {visibleCards.map((content, i) => {
            const isTop = i === 0;
            const scale = 1 - i * 0.04;
            const translateY = i * 12;

            return (
              <div
                key={content.id}
                style={{
                  position: 'absolute',
                  inset: 0,
                  transform: `scale(${scale}) translateY(${translateY}px)`,
                  zIndex: 10 - i,
                  transition: 'transform 0.3s ease',
                }}
              >
                <SwipeCard
                  content={content}
                  onSwipe={(dir) => handleSwipe(dir, content)}
                  onShowDetail={() => {}}
                  isTop={isTop}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
