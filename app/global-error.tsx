'use client';
import { useEffect } from 'react';
import { captureError } from '@/lib/monitoring';

// ルートレイアウトまで波及した致命的エラーを捕捉する最上位バウンダリ。
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    captureError(error, { boundary: 'app/global-error', digest: error.digest });
  }, [error]);

  return (
    <html lang="ja">
      <body style={{ margin: 0, background: '#0f172a', color: '#fff', fontFamily: 'system-ui', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 48 }}>😵</div>
        <h1 style={{ fontSize: 18 }}>エラーが発生しました</h1>
        <p style={{ color: '#94a3b8', fontSize: 14 }}>時間をおいて再度お試しください</p>
        <button
          onClick={reset}
          style={{ marginTop: 20, padding: '12px 24px', borderRadius: 9999, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700 }}
        >
          再読み込み
        </button>
      </body>
    </html>
  );
}
