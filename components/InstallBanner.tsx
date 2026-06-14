'use client';
import { useEffect, useState } from 'react';

const DISMISS_KEY = 'a2hs_dismissed';

// beforeinstallprompt イベント（型は標準 lib に無いため最小定義）
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export default function InstallBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!deferred) return;
    setShow(false);
    await deferred.prompt();
    await deferred.userChoice.catch(() => {});
    localStorage.setItem(DISMISS_KEY, '1');
    setDeferred(null);
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3">
      <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl p-3 shadow-2xl flex items-center gap-3">
        <span className="text-2xl">📱</span>
        <div className="flex-1 min-w-0">
          <p className="text-white font-bold text-sm">ホーム画面に追加</p>
          <p className="text-slate-400 text-xs">アプリのように使えます</p>
        </div>
        <button
          onClick={install}
          className="px-4 py-2 bg-indigo-500 text-white rounded-full font-bold text-xs active:scale-95 transition-transform"
        >
          追加
        </button>
        <button onClick={dismiss} className="text-slate-500 text-lg px-1" aria-label="閉じる">
          ×
        </button>
      </div>
    </div>
  );
}
