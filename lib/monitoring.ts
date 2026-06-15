// 依存ライブラリ不要の軽量エラー監視 / パフォーマンス計測。
// SENTRY_DSN（クライアントは NEXT_PUBLIC_SENTRY_DSN）が設定されていれば
// Sentry の store エンドポイントへベストエフォートで送信する。

const SLOW_API_MS = 1000;

function getDsn(): string | undefined {
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
}

function parseDsn(dsn: string): { key: string; host: string; projectId: string } | null {
  const m = dsn.match(/^https?:\/\/([^@]+)@([^/]+)\/(.+)$/);
  if (!m) return null;
  return { key: m[1], host: m[2], projectId: m[3] };
}

function uuid(): string {
  try {
    return globalThis.crypto?.randomUUID?.().replace(/-/g, '') ?? Math.random().toString(16).slice(2);
  } catch {
    return Math.random().toString(16).slice(2);
  }
}

function sendToSentry(event: Record<string, unknown>): void {
  const dsn = getDsn();
  if (!dsn) return;
  const p = parseDsn(dsn);
  if (!p) return;
  const url = `https://${p.host}/api/${p.projectId}/store/`;
  try {
    void fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${p.key}, sentry_client=baraoshi/1.0`,
      },
      body: JSON.stringify({ event_id: uuid(), timestamp: new Date().toISOString(), platform: 'javascript', ...event }),
    }).catch(() => {});
  } catch {
    // 送信失敗は無視
  }
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  const err = error as { name?: string; message?: string };
  const message = err?.message ?? String(error);
  console.error('[monitor] error:', message, context ?? '');
  sendToSentry({
    level: 'error',
    message,
    exception: { values: [{ type: err?.name ?? 'Error', value: message }] },
    extra: context,
  });
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info', context?: Record<string, unknown>): void {
  sendToSentry({ level, message, extra: context });
}

// API のレスポンスタイムを計測し、閾値超過は自動アラート（warn＋Sentry通知）。
export function trackApiTiming(name: string, ms: number, slowMs = SLOW_API_MS): void {
  if (ms > slowMs) {
    console.warn(`[monitor] SLOW API ${name}: ${ms}ms`);
    captureMessage(`Slow API: ${name} took ${ms}ms`, 'warning', { name, ms });
  } else {
    console.log(`[monitor] API ${name}: ${ms}ms`);
  }
}
