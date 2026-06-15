'use client';
import { useEffect } from 'react';
import { captureError } from '@/lib/monitoring';

// アプリ全体のエラーバウンダリ（レンダリング時の例外を捕捉）。
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureError(error, { boundary: 'app/error', digest: error.digest });
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 text-center px-8">
      <div className="text-5xl mb-4">😵</div>
      <h1 className="text-white text-lg font-bold">エラーが発生しました</h1>
      <p className="text-slate-400 text-sm mt-2">時間をおいて再度お試しください</p>
      <button
        onClick={reset}
        className="mt-5 px-6 py-3 bg-indigo-500 text-white rounded-full font-bold active:scale-95 transition-transform"
      >
        再読み込み
      </button>
    </div>
  );
}
