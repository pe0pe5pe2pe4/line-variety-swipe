// フリーミアムの定数・ユーティリティ
export const FREE_DAILY_SWIPE_LIMIT = 20;
export const FREE_WATCHLATER_LIMIT = 5;
export const PREMIUM_PRICE_JPY = 480;
export const PREMIUM_DAYS = 30;

export type UserPremiumRow = {
  is_premium?: boolean | null;
  premium_until?: string | null;
  daily_swipe_count?: number | null;
  last_swipe_date?: string | null;
};

/** JST の日付文字列 (YYYY-MM-DD) */
export function jstDateString(d: Date = new Date()): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

/** プレミアムが有効か（premium_until があれば期限内かも判定） */
export function isPremiumActive(user: UserPremiumRow | null | undefined): boolean {
  if (!user?.is_premium) return false;
  if (!user.premium_until) return true;
  return new Date(user.premium_until).getTime() > Date.now();
}

/** 当日（JST）の有効なスワイプ数（日付が変わっていれば 0 にリセット） */
export function todaysSwipeCount(user: UserPremiumRow | null | undefined): number {
  if (!user) return 0;
  const today = jstDateString();
  return user.last_swipe_date === today ? Number(user.daily_swipe_count ?? 0) : 0;
}
