'use client';
import { useEffect, useRef, useState } from 'react';
import SwipeCard from '@/components/SwipeCard';
import Onboarding from '@/components/Onboarding';
import DetailModal from '@/components/DetailModal';
import WatchLaterList from '@/components/WatchLaterList';
import MyPage, { Stats, ReferralInfo } from '@/components/MyPage';
import SkeletonCard from '@/components/SkeletonCard';
import SwipeHints from '@/components/SwipeHints';
import PushPrompt from '@/components/PushPrompt';
import InstallBanner from '@/components/InstallBanner';
import { Content } from '@/lib/types';
import { fetchWithRetry } from '@/lib/fetch-retry';

const DUMMY_USER_ID = 'test-user-001';
const ONBOARDING_KEY = 'onboarding_done';
// プリロードするカード枚数（3→5）
const PRELOAD_COUNT = 5;
// 残りがこの枚数以下になったら自動で追加取得（無限スワイプ・プリフェッチ）
const LOW_WATERMARK = 6;
// exclude クエリに載せる直近表示IDの上限（URL肥大を防ぐ）
const EXCLUDE_LIMIT = 200;

// ── スワイプ済みIDの永続化（リロードしても履歴が消えないように localStorage 保存）──
const swipedKey = (uid: string) => `swiped_ids_${uid}`;
function loadSwipedIds(uid: string): string[] {
  try {
    const raw = localStorage.getItem(swipedKey(uid));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveSwipedIds(uid: string, ids: string[]) {
  try {
    // 直近1000件まで保持
    localStorage.setItem(swipedKey(uid), JSON.stringify(ids.slice(-1000)));
  } catch {
    // ストレージ不可時は無視
  }
}

type Tab = 'swipe' | 'watchlater' | 'mypage';

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
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  // これ以上取得できる番組が無くなったか（空状態の表示判定に使用）
  const [reachedEnd, setReachedEnd] = useState(false);
  // 取得に失敗したか（再試行ボタンの表示判定）
  const [loadError, setLoadError] = useState(false);
  // 1回でもスワイプしたか（「あなたへのおすすめ」バッジの表示判定）
  const [hasSwipedOnce, setHasSwipedOnce] = useState(false);

  // 無限スワイプ用：これまで表示したIDを記録し、追加取得時に除外する
  const seenSet = useRef<Set<string>>(new Set());
  const seenOrder = useRef<string[]>([]);
  const loadingMore = useRef(false);
  const exhausted = useRef(false);
  // localStorage に保存するスワイプ済みID
  const swipedIds = useRef<string[]>([]);

  const markSeen = (id: string) => {
    if (seenSet.current.has(id)) return;
    seenSet.current.add(id);
    seenOrder.current.push(id);
  };

  // 起動時に localStorage からスワイプ済みIDを読み込み、除外対象に反映する（バグ1）
  useEffect(() => {
    if (!userId) return;
    const stored = loadSwipedIds(userId);
    swipedIds.current = stored;
    stored.forEach(markSeen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // 追加取得（initial=true で初回ロード）
  const loadMore = async (uid: string, initial = false) => {
    if (loadingMore.current) return;
    if (exhausted.current && !initial) return;
    loadingMore.current = true;
    if (initial) setLoading(true);
    try {
      const exclude = seenOrder.current.slice(-EXCLUDE_LIMIT).join(',');
      const res = await fetchWithRetry(
        `/api/recommend?user_id=${encodeURIComponent(uid)}&exclude=${encodeURIComponent(exclude)}`
      );
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      const items: Content[] = Array.isArray(data) ? data : [];
      setLoadError(false);
      // 既出を除外して重複表示を防ぐ
      const fresh = items.filter((c) => c?.id && !seenSet.current.has(c.id));
      fresh.forEach((c) => markSeen(c.id));
      if (fresh.length === 0) {
        exhausted.current = true;
        setReachedEnd(true);
      }
      setContents((prev) => (initial ? fresh : [...prev, ...fresh]));
    } catch {
      // 3回リトライしても失敗 → エラー表示（手動で再試行できる）
      setLoadError(true);
    } finally {
      loadingMore.current = false;
      if (initial) setLoading(false);
    }
  };

  // ── TASK 2: LIFF 初期化 ──────────────────────────────────
  useEffect(() => {
    async function initUser() {
      const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
      // 招待コード（?ref=XXXXXX）を取得
      const ref =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('ref')
          : null;

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

          // usersテーブルに upsert（fire-and-forget・招待コードを渡す）
          fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              line_user_id: profile.userId,
              display_name: profile.displayName,
              picture_url: profile.pictureUrl ?? null,
              referred_by: ref,
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

  // コンテンツ取得（userId と onboardingDone 両方が揃ってから・初回のみ）
  useEffect(() => {
    if (!userId || !onboardingDone) return;
    loadMore(userId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, onboardingDone]);

  // あとで見るリストをロード（タブ切替時）
  // 楽観的に追加済みのローカル項目はサーバー結果とマージして消えないようにする
  useEffect(() => {
    if (activeTab !== 'watchlater' || !userId) return;
    setWatchLaterLoading(true);
    fetch(`/api/watchlist?user_id=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        const serverItems: Content[] = Array.isArray(data) ? data : [];
        setWatchLater((prev) => {
          const serverIds = new Set(serverItems.map((c) => c.id));
          const localOnly = prev.filter((c) => !serverIds.has(c.id));
          return [...localOnly, ...serverItems];
        });
        setWatchLaterLoading(false);
      })
      .catch(() => setWatchLaterLoading(false));
  }, [activeTab, userId]);

  // マイページ統計をロード（タブ切替時に最新化）
  useEffect(() => {
    if (activeTab !== 'mypage' || !userId) return;
    setStatsLoading(true);
    fetch(`/api/stats?user_id=${userId}`)
      .then((r) => r.json())
      .then((data) => {
        setStats(data && !data.error ? (data as Stats) : null);
        setStatsLoading(false);
      })
      .catch(() => setStatsLoading(false));
    // 招待情報
    fetch(`/api/referral?user_id=${userId}`)
      .then((r) => r.json())
      .then((data) => setReferral(data && !data.error ? (data as ReferralInfo) : null))
      .catch(() => setReferral(null));
  }, [activeTab, userId]);

  // 上スワイプ／「今すぐ見る」の遷移先（厳密制御・ABEMAには絶対飛ばない）
  // youtube → youtube_url / tver → tver_url / tv_show・未設定 → Tver検索
  const openWatchNow = (content: Content) => {
    if (content.content_type === 'youtube' && content.youtube_url) {
      window.open(content.youtube_url, '_blank');
    } else if (content.content_type === 'tver' && content.tver_url) {
      window.open(content.tver_url, '_blank');
    } else {
      window.open(`https://tver.jp/search/#${encodeURIComponent(content.title)}`, '_blank');
    }
  };

  const removeFromWatchLater = (content: Content) => {
    setWatchLater((prev) => prev.filter((c) => c.id !== content.id));
    if (userId) {
      fetch(`/api/watchlist?user_id=${encodeURIComponent(userId)}&content_id=${encodeURIComponent(content.id)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
  };

  const handleSwipe = (direction: 'left' | 'right' | 'up', content: Content) => {
    if (!hasSwipedOnce) setHasSwipedOnce(true);
    setContents((prev) => {
      const next = prev.filter((c) => c.id !== content.id);
      // 残りが少なくなったら自動で追加取得（無限スワイプ）
      if (userId && next.length <= LOW_WATERMARK) {
        loadMore(userId);
      }
      return next;
    });

    if (direction === 'up') {
      openWatchNow(content);
    }

    if (direction === 'right') {
      setWatchLater((prev) => [content, ...prev.filter((c) => c.id !== content.id)]);
    }

    if (userId) {
      // スワイプ済みを localStorage に永続化（バグ1）
      markSeen(content.id);
      if (!swipedIds.current.includes(content.id)) {
        swipedIds.current.push(content.id);
        saveSwipedIds(userId, swipedIds.current);
      }
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
              <SkeletonCard />
            ) : contents.length === 0 ? (
              loadError ? (
                <div className="flex flex-col items-center gap-4 text-center px-8">
                  <span className="text-5xl">😢</span>
                  <p className="text-white text-lg font-bold">コンテンツの読み込みに失敗しました</p>
                  <button
                    onClick={() => { setLoadError(false); if (userId) loadMore(userId, true); }}
                    className="mt-2 px-6 py-3 bg-indigo-500 text-white rounded-full font-bold hover:bg-indigo-400 active:scale-95 transition-all"
                  >
                    再試行
                  </button>
                </div>
              ) : reachedEnd ? (
                <div className="flex flex-col items-center gap-3 text-center px-8">
                  <span className="text-6xl">🎉</span>
                  <p className="text-white text-xl font-bold">今日のコンテンツは全部チェックしました！</p>
                  <p className="text-slate-400 text-sm">明日また新しいコンテンツが追加されます</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 rounded-full border-4 border-indigo-400 border-t-transparent animate-spin" />
                  <p className="text-slate-400 text-sm">読み込み中...</p>
                </div>
              )
            ) : (
              <>
                <div className="w-full max-w-sm mb-4 text-center">
                  <h1 className="text-white text-2xl font-black tracking-tight">バラエティ発見</h1>
                  <p className="text-slate-400 text-xs mt-1">タップで詳細 / 上スワイプで今すぐ見る</p>
                </div>

                <div className="relative w-full max-w-sm" style={{ height: 'min(640px, calc(100dvh - 180px))' }}>
                  {/* 3枚目は影だけ表示して「まだある」感を出す */}
                  {contents.length > PRELOAD_COUNT && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        transform: `scale(${1 - PRELOAD_COUNT * 0.04}) translateY(${PRELOAD_COUNT * 12}px)`,
                        zIndex: 10 - PRELOAD_COUNT,
                      }}
                      className="rounded-3xl bg-slate-800/60 shadow-xl"
                    />
                  )}
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
                          featured={isTop && !hasSwipedOnce}
                        />
                      </div>
                    );
                  })}
                  {/* 初回起動時のみ操作説明 */}
                  <SwipeHints />
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
              <WatchLaterList
                items={watchLater}
                onShowDetail={handleShowDetail}
                onWatchNow={openWatchNow}
                onRemove={removeFromWatchLater}
              />
            )}
          </div>
        )}

        {/* Tab: My Page (統計) */}
        {activeTab === 'mypage' && (
          <div className="flex flex-col flex-1 pt-6">
            <div className="w-full max-w-sm mx-auto px-4 mb-4">
              <h1 className="text-white text-2xl font-black tracking-tight">マイページ</h1>
              <p className="text-slate-400 text-xs mt-1">あなたのスワイプ統計</p>
            </div>
            <MyPage stats={stats} referral={referral} loading={statsLoading} />
          </div>
        )}
      </main>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-slate-900/95 backdrop-blur border-t border-slate-700 flex z-40 safe-bottom">
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
        <button
          onClick={() => setActiveTab('mypage')}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
            activeTab === 'mypage' ? 'text-indigo-400' : 'text-slate-500'
          }`}
        >
          <span className="text-xl">📊</span>
          <span>マイページ</span>
        </button>
      </nav>

      {/* Detail modal */}
      {modalContent && (
        <DetailModal content={modalContent} userId={userId} onClose={() => setModalContent(null)} />
      )}

      {/* Push 通知の許可ダイアログ（3回目以降の起動で表示） */}
      <PushPrompt userId={userId} />

      {/* PWA ホーム画面追加バナー */}
      <InstallBanner />
    </>
  );
}
