'use client';
import { useState, useEffect } from 'react';
import SwipeCard from './SwipeCard';

type Content = {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  vod_affiliate_url: string;
};

const ONBOARDING_KEY = 'onboarding_done';
const ONBOARDING_COUNT = 20;

type Props = {
  onComplete: () => void;
};

export default function Onboarding({ onComplete }: Props) {
  const [contents, setContents] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [swiped, setSwiped] = useState(0);

  useEffect(() => {
    fetch('/api/contents?user_id=onboarding')
      .then((r) => r.json())
      .then((data) => {
        const items = Array.isArray(data) ? data.slice(0, ONBOARDING_COUNT) : [];
        setContents(items);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSwipe = (direction: 'left' | 'right', content: Content) => {
    const next = contents.filter((c) => c.id !== content.id);
    const newSwiped = swiped + 1;
    setSwiped(newSwiped);
    setContents(next);

    if (next.length === 0 || newSwiped >= ONBOARDING_COUNT) {
      localStorage.setItem(ONBOARDING_KEY, '1');
      onComplete();
    }
  };

  const handleSkip = () => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    onComplete();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950">
        <div className="w-10 h-10 rounded-full border-4 border-indigo-400 border-t-transparent animate-spin" />
      </div>
    );
  }

  const progress = Math.min((swiped / ONBOARDING_COUNT) * 100, 100);
  const visibleCards = contents.slice(0, 3);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 px-4">
      {/* Header */}
      <div className="w-full max-w-sm mb-4 text-center">
        <h1 className="text-white text-2xl font-black tracking-tight">好きな番組を選んでください</h1>
        <p className="text-slate-400 text-sm mt-1">右にスワイプ = 好き / 左 = スキップ</p>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-sm mb-6">
        <div className="flex justify-between text-slate-400 text-xs mb-1">
          <span>{swiped} / {ONBOARDING_COUNT}</span>
          <button onClick={handleSkip} className="underline hover:text-white transition-colors">
            スキップ
          </button>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-1.5">
          <div
            className="bg-indigo-400 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Card stack */}
      {contents.length === 0 ? (
        <div className="text-center">
          <p className="text-white text-lg font-bold">完了！</p>
          <button
            onClick={handleSkip}
            className="mt-4 px-6 py-3 bg-indigo-500 text-white rounded-full font-bold hover:bg-indigo-400 transition-colors"
          >
            メイン画面へ
          </button>
        </div>
      ) : (
        <div className="relative w-full max-w-sm" style={{ height: '520px' }}>
          {visibleCards.map((content, i) => {
            const isTop = i === 0;
            const scale = 1 - (visibleCards.length - 1 - i) * 0.04;
            const translateY = (visibleCards.length - 1 - i) * 8;

            return (
              <div
                key={content.id}
                style={{
                  position: 'absolute',
                  inset: 0,
                  transform: `scale(${scale}) translateY(${translateY}px)`,
                  zIndex: isTop ? 10 : i,
                  transition: 'transform 0.2s ease',
                }}
              >
                <SwipeCard
                  content={content}
                  onSwipe={(dir) => handleSwipe(dir, content)}
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
