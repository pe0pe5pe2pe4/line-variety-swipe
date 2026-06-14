const TMDB_BASE = 'https://api.themoviedb.org/3';

function buildTMDBRequest(path: string, params: Record<string, string>): { url: string; headers: HeadersInit } {
  const key = process.env.TMDB_API_KEY ?? '';
  const p = new URLSearchParams(params);

  if (key.startsWith('eyJ')) {
    // v4 Bearer token (JWT)
    return {
      url: `${TMDB_BASE}${path}?${p}`,
      headers: { Authorization: `Bearer ${key}` },
    };
  }
  // v3 api_key（クエリパラメータ）
  p.set('api_key', key);
  return { url: `${TMDB_BASE}${path}?${p}`, headers: {} };
}

// TMDB の last_episode_to_air から最新放送回情報を取得
export async function fetchTMDBLastEpisode(tmdbId: number): Promise<{
  episode_number: string | null;
  episode_title: string | null;
  broadcast_date: string | null;
}> {
  const empty = { episode_number: null, episode_title: null, broadcast_date: null };
  const key = process.env.TMDB_API_KEY ?? '';
  if (!key) return empty;

  try {
    const { url, headers } = buildTMDBRequest(`/tv/${tmdbId}`, { language: 'ja-JP' });
    const res = await fetch(url, { headers });
    if (!res.ok) return empty;
    const data = await res.json();
    const ep = data.last_episode_to_air;
    if (!ep) return empty;

    // "2024-03-15" → "2024年3月15日"
    let broadcast_date: string | null = null;
    if (ep.air_date) {
      const parts = String(ep.air_date).split('-').map(Number);
      if (parts.length === 3) {
        broadcast_date = `${parts[0]}年${parts[1]}月${parts[2]}日`;
      }
    }

    return {
      episode_number: ep.episode_number ? `第${ep.episode_number}話` : null,
      episode_title: ep.name ?? null,
      broadcast_date,
    };
  } catch {
    return empty;
  }
}

export async function searchTMDBShow(title: string): Promise<{
  tmdb_id: number | null;
  thumbnail_url: string;
  description: string;
}> {
  const empty = { tmdb_id: null, thumbnail_url: '', description: '' };
  const key = process.env.TMDB_API_KEY ?? '';
  if (!key) return empty;

  try {
    const { url, headers } = buildTMDBRequest('/search/tv', { query: title, language: 'ja-JP' });
    const res = await fetch(url, { headers });
    if (!res.ok) return empty;
    const data = await res.json();
    const item = data?.results?.[0];
    if (!item) return empty;

    return {
      tmdb_id: item.id ?? null,
      thumbnail_url: item.poster_path
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : item.backdrop_path
        ? `https://image.tmdb.org/t/p/w500${item.backdrop_path}`
        : '',
      description: item.overview ?? '',
    };
  } catch {
    return empty;
  }
}
