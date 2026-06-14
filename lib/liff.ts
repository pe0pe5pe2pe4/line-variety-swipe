export type LiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

/**
 * LIFF を初期化してプロフィールを返す。
 * - 未ログインの場合は liff.login() でリダイレクト（null を返す）
 * - SSR / LIFF_ID 未設定時は null を返す（呼び出し元で DUMMY_USER_ID にフォールバック）
 */
export async function initializeLiff(): Promise<LiffProfile | null> {
  // SSR ガード
  if (typeof window === 'undefined') return null;

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId || liffId === 'dummy') return null;

  // @line/liff はブラウザ専用のため動的インポート
  const { default: liff } = await import('@line/liff');

  await liff.init({ liffId });

  if (!liff.isLoggedIn()) {
    liff.login();
    return null; // LINE ログイン画面へリダイレクト中
  }

  const profile = await liff.getProfile();
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl ?? undefined,
  };
}
