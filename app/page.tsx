'use client';
import { useEffect, useRef, useState } from 'react';
import SwipeCard from '@/components/SwipeCard';
import Onboarding from '@/components/Onboarding';
import DetailModal from '@/components/DetailModal';
import WatchLaterList from '@/components/WatchLaterList';
import { Content } from '@/lib/types';

const DUMMY_USER_ID = 'test-user-001';
const ONBOARDING_KEY = 'onboarding_done';
const PRELOAD_COUNT = 3;

type Tab = 'swipe' | 'watchlater';

export default function Home() {
  // userId: null = LIFF初期化中（ローディング表示）
  const [userId, setUserId] = useState<string | null>(null);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [contents, setContents] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('swipe');
  const [modalContent, setModalContent] = useState<Content | null>(null);
  const [watchLater, setWatchLater] = useState<Content[]>([]);
  const [watchLaterLoading, setWatchLaterLoading] = useState(false);

  // ── TASK 2: LIFF 初期化 ──────────────────────────────────
  useEffect(() => {
    async function initUser() {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;

      // LIFF_ID が未設定 or 'dummy' → 開発用フォールバック
      if (!liffId || liffId === 'dummy') {
        setUserId(DUMMY_USER_ID);
        return;
      }

      try {
        const { initializeLiff } = await import('@/lib/liff');
        const profile = await initializeLiff();

        if (profile) {
          setUserId(profile.userId);

          // usersテーブルに upsert（fire-and-forget）
          fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              line_user_id: profile.userId,
              display_name: profile.displayName,
              picture_url: profile.pictureUrl ?? null,
            }),
          }).catch(() => {});
        }
        // profile が null の場合は liff.login() でリダイレクト中
        // → userId は null のままローディング表示を維持
      } catch {
        // 初期化失敗時は開発用 ID にフォールバック
        setUserId(DUMMY_USER_ID);
      }
    }

    initUser();
  }, []);

  // オンボーディング確認（同期的なので userId と独立して即実行）
  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY) === '1';
    setOnboardingDone(done);
  }, []);

  // コンテンツ取得（userId と onboardingDone 両方が揃ってから）
  useEffect(() => {
    if (!userId || !onboardingDone) return;
    setLoading(true);
    fetch(`/api/recommend?user_id=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        setContents(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId, onboardingDone]);

  // あとで見るリストをロード（タブ切替時）
  useEffect(() => {
    if (activeTab !== 'watchlater' || !userId) return;
    setWatchLaterLoading(true);
    fetch(`/api/swipes?user_id=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        setWatchLater(Array.isArray(data) ? data : []);
        setWatchLaterLoading(false);
      })
      .catch(() => setWatchLaterLoading(false));
  }, [activeTab, userId]);

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

  const handleSwipe = (direction: 'left' | 'right' | 'up', content: Content) => {
    setContents((prev) => prev.filter((c) => c.id !== content.id));

    if (direction === 'up') {
      if (content.content_type === 'youtube' && content.youtube_url) {
        window.open(content.youtube_url, '_blank');
      } else {
        window.open(`https://tver.jp/search/#${encodeURIComponent(content.title)}`, '_blank');
      }
    }

    if (direction === 'right') {
      setWatchLater((prev) => [content, ...prev.filter((c) => c.id !== content.id)]);
    }

    if (userId) {
      fetch('/api/swipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, content_id: content.id, direction }),
      }).catch(() => {});
    }
  };

  const handleShowDetail = (content: Content) => setModalContent(content);

  // ── ローディング：userId または onboardingDone が未確定 ──
  if (userId === null || onboardingDone === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-indigo-400 border-t-transparent animate-spin" />
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      </div>
    );
  }

  // ── オンボーディング ──
  if (!onboardingDone) {
    return (
      <Onboarding
        userId={userId}
        onComplete={() => setOnboardingDone(true)}
      />
    );
  }

  const visibleCards = contents.slice(0, PRELOAD_COUNT);

  return (
    <>
      <main className="flex flex-col min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 pb-16">
        {/* Tab: Swipe */}
        {activeTab === 'swipe' && (
          <div className="flex flex-col items-center justify-center flex-1 px-4 pt-4 min-h-[calc(100vh-64px)]">
            {loading ? (
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 rounded-full border-4 border-indigo-400 border-t-transparent animate-spin" />
                <p className="text-slate-400 text-sm">読み込み中...</p>
              </div>
            ) : contents.length === 0 ? (
              <div className="flex flex-col items-center gap-3 text-center px-8">
                <span className="text-6xl">🎉</span>
                <p className="text-white text-xl font-bold">すべてチェックしました！</p>
                <p className="text-slate-400 text-sm">また後で来てください</p>
              </div>
            ) : (
              <>
                <div className="w-full max-w-sm mb-4 text-center">
                  <h1 className="text-white text-2xl font-black tracking-tight">バラエティ発見</h1>
                  <p className="text-slate-400 text-xs mt-1">タップで詳細 / 上スワイプで今すぐ見る</p>
                </div>

                <div className="relative w-full max-w-sm" style={{ height: '520px' }}>
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
                          onShowDetail={() => handleShowDetail(content)}
                          isTop={isTop}
                        />
                      </div>
                    );
                  })}
                </div>

                <p className="mt-4 text-slate-500 text-xs">{contents.length} 本残り</p>
              </>
            )}
          </div>
        )}

        {/* Tab: Watch Later */}
        {activeTab === 'watchlater' && (
          <div className="flex flex-col flex-1 pt-6">
            <div className="w-full max-w-sm mx-auto px-4 mb-4">
              <h1 className="text-white text-2xl font-black tracking-tight">あとで見る</h1>
              <p className="text-slate-400 text-xs mt-1">右スワイプした番組・動画</p>
            </div>
            {watchLaterLoading ? (
              <div className="flex justify-center mt-10">
                <div className="w-10 h-10 rounded-full border-4 border-indigo-400 border-t-transparent animate-spin" />
              </div>
            ) : (
              <WatchLaterList items={watchLater} onShowDetail={handleShowDetail} />
            )}
          </div>
        )}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-slate-900/95 backdrop-blur border-t border-slate-700 flex z-40">
        <button
          onClick={() => setActiveTab('swipe')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
            activeTab === 'swipe' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <span className="text-xl">🃏</span>
          <span>スワイプ</span>
        </button>
        <button
          onClick={() => setActiveTab('watchlater')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
            activeTab === 'watchlater' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <span className="text-xl">📋</span>
          <span>あとで見る</span>
        </button>
      </nav>

      {/* Detail modal */}
      {modalContent && (
        <DetailModal content={modalContent} onClose={() => setModalContent(null)} />
      )}
    </>
  );
}
