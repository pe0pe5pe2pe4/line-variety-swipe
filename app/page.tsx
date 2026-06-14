'use client';
import { useEffect, useRef, useState } from 'react';
import SwipeCard from '@/components/SwipeCard';
import Onboarding from '@/components/Onboarding';

type Content = {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  vod_affiliate_url: string;
};

const DUMMY_USER_ID = 'test-user-001';
const ONBOARDING_KEY = 'onboarding_done';
const PRELOAD_COUNT = 3;

export default function Home() {
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [contents, setContents] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY) === '1';
    setOnboardingDone(done);
  }, []);

  useEffect(() => {
    if (!onboardingDone) return;
    fetch(`/api/contents?user_id=${DUMMY_USER_ID}`)
      .then((r) => r.json())
      .then((data) => {
        setContents(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [onboardingDone]);

  // プリロード済み画像をrefで保持（GC防止）
  const preloadCache = useRef<Map<string, HTMLImageElement>>(new Map());

  useEffect(() => {
    contents.forEach((c) => {
      if (!c.thumbnail_url || preloadCache.current.has(c.thumbnail_url)) return;
      const img = new Image();
      img.src = c.thumbnail_url;
      preloadCache.current.set(c.thumbnail_url, img);
    });
  }, [contents]);

  const handleSwipe = (direction: 'left' | 'right', content: Content) => {
    // カードを即座に削除してちらつきを防ぐ
    setContents((prev) => prev.filter((c) => c.id !== content.id));

    if (direction === 'right' && content.vod_affiliate_url) {
      window.open(content.vod_affiliate_url, '_blank');
    }

    // スワイプログはバックグラウンドで保存（awaitしない）
    fetch('/api/swipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: DUMMY_USER_ID,
        content_id: content.id,
        direction,
      }),
    }).catch(() => {});
  };

  // Wait for localStorage check
  if (onboardingDone === null) return null;

  // Show onboarding on first visit
  if (!onboardingDone) {
    return <Onboarding onComplete={() => setOnboardingDone(true)} />;
  }

  if (loading) {
    return (
      <main className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-indigo-400 border-t-transparent animate-spin" />
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      </main>
    );
  }

  if (contents.length === 0) {
    return (
      <main className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950">
        <div className="flex flex-col items-center gap-3 text-center px-8">
          <span className="text-6xl">🎉</span>
          <p className="text-white text-xl font-bold">すべてチェックしました！</p>
          <p className="text-slate-400 text-sm">また後で来てください</p>
        </div>
      </main>
    );
  }

  const visibleCards = contents.slice(0, PRELOAD_COUNT);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 px-4">
      {/* Header */}
      <div className="w-full max-w-sm mb-6 text-center">
        <h1 className="text-white text-2xl font-black tracking-tight">バラエティ発見</h1>
        <p className="text-slate-400 text-xs mt-1">左右にスワイプして好みを教えてください</p>
      </div>

      {/* Card stack */}
      <div className="relative w-full max-w-sm" style={{ height: '520px' }}>
        {visibleCards.map((content, i) => {
          const isTop = i === 0;
          // i=0(top): scale=1.0, y=0, zIndex=10
          // i=1(2nd): scale=0.96, y=12px, zIndex=9
          // i=2(3rd): scale=0.92, y=24px, zIndex=8
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
                isTop={isTop}
              />
            </div>
          );
        })}
      </div>

      {/* Remaining count */}
      <p className="mt-6 text-slate-500 text-xs">{contents.length} 本残り</p>
    </main>
  );
}
