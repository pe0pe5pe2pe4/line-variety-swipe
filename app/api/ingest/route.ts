import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const area = searchParams.get('area') ?? '130';
  const service = searchParams.get('service') ?? 'g1';

  const date = new Date().toISOString().split('T')[0];
  const nhkUrl = `https://program-api.nhk.jp/v3/papiPgDateTv?service=${service}&area=${area}&date=${date}&key=${process.env.NHK_API_KEY}`;

  const nhkRes = await fetch(nhkUrl);
  const nhkData = await nhkRes.json();

  const programs = nhkData?.[service]?.publication ?? [];

  let inserted = 0;

  for (const program of programs.slice(0, 5)) {
    const title = program.name;
    const description = program.description ?? '';
    const nhk_program_id = program.id;
    const broadcast_at = program.startDate;
    const genre = program.identifierGroup?.genre?.[0]?.name1 ?? '';

    // TMDBで検索
    const tmdbRes = await fetch(
      `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(title)}&language=ja-JP`,
      { headers: { Authorization: `Bearer ${process.env.TMDB_API_KEY}` } }
    );
    const tmdbData = await tmdbRes.json();
    const tmdbItem = tmdbData?.results?.[0];
    const thumbnail_url = tmdbItem?.poster_path
      ? `https://image.tmdb.org/t/p/w500${tmdbItem.poster_path}`
      : '';
    const tmdb_id = tmdbItem?.id ?? null;

    const { error } = await supabase.from('contents').upsert(
      {
        title,
        description,
        genre,
        nhk_program_id,
        broadcast_at,
        thumbnail_url,
        tmdb_id,
        source: 'nhk',
      },
      { onConflict: 'nhk_program_id' }
    );
    if (error) {
      return NextResponse.json({ error, title, nhk_program_id });
    }
    
    if (!error) inserted++;
  }

  return NextResponse.json({ inserted });
}