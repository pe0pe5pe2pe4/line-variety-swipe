// U-NEXT アフィリエイトリンクの動的生成。
// vod_affiliate_url が設定済みならそれを優先。未設定でも
// NEXT_PUBLIC_UNEXT_AFFILIATE_ID があれば a8.net 経由の検索URLを生成する。
export function unextAffiliateUrl(title: string, existing?: string | null): string | null {
  const e = existing?.trim();
  if (e) return e;
  const id = process.env.NEXT_PUBLIC_UNEXT_AFFILIATE_ID;
  if (!id) return null;
  const target = `https://video.unext.jp/search?query=${encodeURIComponent(title)}`;
  return `https://px.a8.net/svt/ejp?a8mat=${id}&a8ejpredirect=${encodeURIComponent(target)}`;
}

// VODボタンのクリックを記録する（fire-and-forget）。
export function trackClick(params: { userId?: string | null; contentId: string; service: string }) {
  try {
    fetch('/api/track-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        user_id: params.userId ?? null,
        content_id: params.contentId,
        service: params.service,
      }),
    }).catch(() => {});
  } catch {
    // 失敗しても遷移は続行
  }
}
