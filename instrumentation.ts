// Next.js の instrumentation フック。起動時に必須環境変数の有無を確認する。
// 参考: node_modules/next/dist/docs/01-app/.../instrumentation

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const RECOMMENDED = [
  'YOUTUBE_API_KEY',
  'ANTHROPIC_API_KEY',
  'CRON_SECRET',
  'NEXT_PUBLIC_LIFF_ID',
] as const;

export async function register() {
  const missingRequired = REQUIRED.filter((k) => !process.env[k]);
  const missingRecommended = RECOMMENDED.filter((k) => !process.env[k]);

  if (missingRequired.length > 0) {
    // 必須が無いと Supabase アクセスが全て失敗するため明示的に警告
    console.error(
      `[env-check] 必須環境変数が未設定です: ${missingRequired.join(', ')}`
    );
  }
  if (missingRecommended.length > 0) {
    console.warn(
      `[env-check] 一部機能に必要な環境変数が未設定です: ${missingRecommended.join(', ')}`
    );
  }
  if (missingRequired.length === 0) {
    console.log('[env-check] 必須環境変数は揃っています');
  }
}

// サーバー側（Route Handler / RSC）で発生したエラーを捕捉して監視へ送る。
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string }
) {
  try {
    const { captureError } = await import('@/lib/monitoring');
    captureError(error, { path: request?.path, method: request?.method, runtime: 'server' });
  } catch {
    console.error('[monitor] onRequestError', error);
  }
}
