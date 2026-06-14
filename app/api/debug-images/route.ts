import { NextResponse } from 'next/server';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const WIKI_API = 'https://ja.wikipedia.org/w/api.php';

async function safeFetch(url: string, options?: RequestInit): Promise<unknown> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    const text = await res.text();
    try {
      return { status: res.status, body: JSON.parse(text) };
    } catch {
      return { status: res.status, body: text.slice(0, 200) };
    }
  } catch (e) {
    return { error: String(e) };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title') ?? 'アメトーーク';

  const tmdbKey = process.env.TMDB_API_KEY ?? '';
  const keySet = tmdbKey.length > 0;
  const keyType = !keySet ? 'NOT SET' : tmdbKey.startsWith('eyJ') ? 'v4 Bearer (JWT)' : 'v3 api_key';

  // TMDB: v3とv4どちらの形式でも動くよう両方試す
  let tmdbResult: unknown = { skipped: 'TMDB_API_KEY not set' };
  if (keySet) {
    const isJWT = tmdbKey.startsWith('eyJ');

    if (isJWT) {
      // v4: Authorization: Bearer ヘッダー
      const url = `${TMDB_BASE}/search/tv?query=${encodeURIComponent(title)}&language=ja-JP`;
      tmdbResult = await safeFetch(url, {
        headers: { Authorization: `Bearer ${tmdbKey}` },
      });
    } else {
      // v3: api_key クエリパラメータ
      const url = `${TMDB_BASE}/search/tv?api_key=${tmdbKey}&query=${encodeURIComponent(title)}&language=ja-JP`;
      tmdbResult = await safeFetch(url);
    }
  }

  // Wikipedia pageimages
  const wikiUrl =
    `${WIKI_API}?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&pithumbsize=500&format=json&origin=*`;
  const wikiResult = await safeFetch(wikiUrl);

  // 結果をわかりやすく整形
  const tmdbBody = (tmdbResult as { body?: { results?: { name: string; poster_path: string | null }[]; total_results?: number; status_message?: string } })?.body;
  const wikiBody = (wikiResult as { body?: { query?: { pages?: Record<string, { thumbnail?: { source: string } }> } } })?.body;
  const wikiPages = wikiBody?.query?.pages ?? {};
  const wikiPage = Object.values(wikiPages)[0];

  return NextResponse.json({
    title,
    env: { TMDB_API_KEY: keyType },
    tmdb: {
      raw_status: (tmdbResult as { status?: number })?.status,
      total_results: tmdbBody?.total_results,
      error: tmdbBody?.status_message ?? null,
      first_hit: tmdbBody?.results?.[0]
        ? { name: tmdbBody.results[0].name, poster_path: tmdbBody.results[0].poster_path }
        : null,
    },
    wikipedia: {
      thumbnail: wikiPage?.thumbnail?.source ?? null,
    },
  });
}
