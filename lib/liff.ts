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

/**
 * LINE の友達に直接シェア（shareTargetPicker）。
 * LINE 環境でなければ false を返す（呼び出し元で Web Share / LINE URL にフォールバック）。
 */
export async function shareViaLiff(text: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId || liffId === 'dummy') return false;

  try {
    const { default: liff } = await import('@line/liff');
    try {
      await liff.init({ liffId });
    } catch {
      // 既に初期化済みなら無視
    }
    if (typeof liff.isApiAvailable === 'function' && liff.isApiAvailable('shareTargetPicker')) {
      await liff.shareTargetPicker([{ type: 'text', text }]);
      return true;
    }
  } catch {
    // 失敗時はフォールバックさせる
  }
  return false;
}
