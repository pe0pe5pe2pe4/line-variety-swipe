import { NextResponse } from 'next/server';

const TMDB_BASE = 'https://api.themoviedb.org/3';
const WIKIPEDIA_API = 'https://ja.wikipedia.org/w/api.php';

// TMDB_API_KEYがv3キー（短い文字列）かv4 Bearerトークン（JWT）か判定
function buildTMDBHeaders(key: string): HeadersInit {
  if (key.startsWith('eyJ')) {
    // v4 Bearer token
    return { Authorization: `Bearer ${key}` };
  }
  // v3 API key → ヘッダー不要（クエリパラメータで渡す）
  return {};
}

function buildTMDBUrl(endpoint: string, key: string, params: Record<string, string>): string {
  const p = new URLSearchParams(params);
  if (!key.startsWith('eyJ')) {
    p.set('api_key', key);
  }
  return `${TMDB_BASE}${endpoint}?${p}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title');

  if (!title) {
    return NextResponse.json({ error: 'title query param required. e.g. /api/debug-images?title=アメトーーク' }, { status: 400 });
  }

  const tmdbKey = process.env.TMDB_API_KEY ?? '';
  const keyType = tmdbKey.startsWith('eyJ') ? 'v4 Bearer token' : tmdbKey ? 'v3 api_key' : 'NOT SET';

  // --- TMDB: language=ja-JP ---
  const tmdbUrlJa = buildTMDBUrl('/search/tv', tmdbKey, { query: title, language: 'ja-JP' });
  const tmdbResJa = tmdbKey
    ? await fetch(tmdbUrlJa, { headers: buildTMDBHeaders(tmdbKey) })
    : null;
  const tmdbDataJa = tmdbResJa ? await tmdbResJa.json() : { error: 'TMDB_API_KEY not set' };

  // --- TMDB: language=ja-JP + region=JP ---
  const tmdbUrlJaJp = buildTMDBUrl('/search/tv', tmdbKey, { query: title, language: 'ja-JP', region: 'JP' });
  const tmdbResJaJp = tmdbKey
    ? await fetch(tmdbUrlJaJp, { headers: buildTMDBHeaders(tmdbKey) })
    : null;
  const tmdbDataJaJp = tmdbResJaJp ? await tmdbResJaJp.json() : null;

  // --- TMDB: 英語クエリ（タイトルの英訳試行なし、そのまま）---
  const tmdbUrlEn = buildTMDBUrl('/search/tv', tmdbKey, { query: title });
  const tmdbResEn = tmdbKey
    ? await fetch(tmdbUrlEn, { headers: buildTMDBHeaders(tmdbKey) })
    : null;
  const tmdbDataEn = tmdbResEn ? await tmdbResEn.json() : null;

  // --- Wikipedia pageimages ---
  const wikiParams = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'pageimages',
    pithumbsize: '500',
    format: 'json',
    origin: '*',
  });
  const wikiRes = await fetch(`${WIKIPEDIA_API}?${wikiParams}`);
  const wikiData = await wikiRes.json();
  const wikiPages = wikiData?.query?.pages ?? {};
  const wikiPage = Object.values(wikiPages)[0] as Record<string, unknown> | undefined;

  return NextResponse.json({
    title,
    tmdbKeyType: keyType,
    tmdbKeyPrefix: tmdbKey ? tmdbKey.slice(0, 8) + '...' : 'NOT SET',
    tmdb_ja: {
      url: tmdbUrlJa,
      status: tmdbResJa?.status,
      totalResults: tmdbDataJa?.total_results,
      firstResult: tmdbDataJa?.results?.[0]
        ? {
            name: tmdbDataJa.results[0].name,
            original_name: tmdbDataJa.results[0].original_name,
            poster_path: tmdbDataJa.results[0].poster_path,
            backdrop_path: tmdbDataJa.results[0].backdrop_path,
          }
        : null,
      error: tmdbDataJa?.errors ?? tmdbDataJa?.status_message ?? null,
    },
    tmdb_ja_jp: {
      totalResults: tmdbDataJaJp?.total_results,
      firstResult: tmdbDataJaJp?.results?.[0]?.name ?? null,
    },
    tmdb_no_lang: {
      totalResults: tmdbDataEn?.total_results,
      firstResult: tmdbDataEn?.results?.[0]?.name ?? null,
    },
    wikipedia: {
      pageId: wikiPage?.pageid,
      title: wikiPage?.title,
      thumbnail: wikiPage?.thumbnail ?? null,
    },
  });
}
