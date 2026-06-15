'use client';
import { useEffect, useState } from 'react';

// オフライン検知バナー。復帰時に自動リロード。
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setOffline(!navigator.onLine);

    const goOffline = () => setOffline(true);
    const goOnline = () => {
      setOffline(false);
      // ネットワーク復帰 → 最新コンテンツを取り直すため自動リロード
      window.location.reload();
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-50 bg-amber-500 text-black text-xs font-bold text-center py-2 px-3">
      オフラインです。キャッシュされたコンテンツを表示しています
    </div>
  );
}
