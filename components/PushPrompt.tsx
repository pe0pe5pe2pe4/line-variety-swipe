'use client';
import { useEffect, useState } from 'react';

const OPEN_COUNT_KEY = 'app_open_count';
const PUSH_ASKED_KEY = 'push_asked';
const SHOW_AT_OPEN = 3; // 3回目以降の起動で通知許可を促す

type Props = { userId: string | null };

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function PushPrompt({ userId }: Props) {
  const [show, setShow] = useState(false);

  // Service Worker 登録 + 起動回数カウント
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const count = Number(localStorage.getItem(OPEN_COUNT_KEY) ?? '0') + 1;
    localStorage.setItem(OPEN_COUNT_KEY, String(count));

    const asked = localStorage.getItem(PUSH_ASKED_KEY) === '1';
    const supported =
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      typeof Notification !== 'undefined';

    if (supported && !asked && count >= SHOW_AT_OPEN && Notification.permission === 'default') {
      setShow(true);
    }
  }, []);

  const subscribe = async () => {
    localStorage.setItem(PUSH_ASKED_KEY, '1');
    setShow(false);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const reg = await navigator.serviceWorker.ready;
      const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      // VAPID 公開鍵が無い環境では購読を作れないため通知許可のみ取得して終了
      if (!vapid) return;

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid) as unknown as BufferSource,
      });

      await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, subscription }),
      }).catch(() => {});
    } catch {
      // 失敗しても致命的ではない
    }
  };

  const dismiss = () => {
    localStorage.setItem(PUSH_ASKED_KEY, '1');
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4">
      <div className="w-full max-w-sm bg-slate-800 border border-slate-700 rounded-2xl p-4 shadow-2xl">
        <p className="text-white font-bold text-sm">🔔 新着番組をお知らせ</p>
        <p className="text-slate-400 text-xs mt-1">
          新しいバラエティ番組が追加されたら通知でお知らせします
        </p>
        <div className="flex gap-2 mt-3">
          <button
            onClick={subscribe}
            className="flex-1 py-2.5 bg-indigo-500 text-white rounded-full font-bold text-sm active:scale-95 transition-transform"
          >
            通知をオンにする
          </button>
          <button
            onClick={dismiss}
            className="px-4 py-2.5 text-slate-400 text-sm"
          >
            あとで
          </button>
        </div>
      </div>
    </div>
  );
}
