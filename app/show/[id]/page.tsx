import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { extractYouTubeId, getThumbnailSrc, hasValidThumbnail, type Content } from '@/lib/types';
import Comments from '@/components/Comments';

export const dynamic = 'force-dynamic';

async function getContent(id: string): Promise<Content | null> {
  try {
    const { data } = await supabase.from('contents').select('*').eq('id', id).maybeSingle();
    return (data as Content) ?? null;
  } catch {
    return null;
  }
}

// 番組ごとのOGP（タイトル・サムネイル）。シェアURLでサムネイルがカードに出る。
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const content = await getContent(id);
  if (!content) return { title: 'バラ推し' };

  const title = `${content.title} | バラ推し`;
  const description =
    (content.enriched_description || content.description || 'バラエティ番組をスワイプで発見').slice(0, 120);
  const images = hasValidThumbnail(content.thumbnail_url) ? [content.thumbnail_url] : undefined;

  return {
    title,
    description,
    openGraph: { title, description, type: 'article', ...(images ? { images } : {}) },
    twitter: { card: 'summary_large_image', title, description, ...(images ? { images } : {}) },
  };
}

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const content = await getContent(id);
  const appUrl = process.env.NEXT_PUBLIC_LIFF_ID
    ? `https://liff.line.me/${process.env.NEXT_PUBLIC_LIFF_ID}`
    : '/';

  if (!content) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: '#fff' }}>
        <p>番組が見つかりませんでした</p>
      </main>
    );
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg,#0f172a,#1e1b4b)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* シェアの単位は「1本の動画」— 受け取った人がアプリ無しでその場で観られるようにする */}
        {(() => {
          const ytId = extractYouTubeId(content.youtube_url) ?? extractYouTubeId(content.preview_youtube_url);
          if (ytId) {
            return (
              <iframe
                style={{ width: '100%', aspectRatio: '16/9', border: 0, borderRadius: 16, background: '#000', display: 'block' }}
                src={`https://www.youtube.com/embed/${ytId}?playsinline=1&rel=0&modestbranding=1`}
                title={content.title}
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
              />
            );
          }
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={getThumbnailSrc(content.thumbnail_url)}
              alt={content.title}
              style={{ width: '100%', borderRadius: 16, aspectRatio: '16/9', objectFit: 'cover', background: '#334155' }}
            />
          );
        })()}
        {/* フック：再生数（あれば）を数字で見せる */}
        {typeof content.yt_view_count === 'number' && content.yt_view_count >= 10_000 && (
          <p style={{ marginTop: 10, fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>
            ▶ {Math.round(content.yt_view_count / 10_000)}万回再生
            {typeof content.yt_subscriber_count === 'number' &&
              content.yt_subscriber_count > 0 &&
              content.yt_view_count / content.yt_subscriber_count >= 3 &&
              ' ・💎 登録者の割にバズってる隠れた実力派'}
          </p>
        )}
        <h1 style={{ fontSize: 24, fontWeight: 900, marginTop: 12 }}>{content.title}</h1>
        {content.channel_name && <p style={{ color: '#94a3b8', fontSize: 13 }}>{content.channel_name}</p>}
        <p style={{ color: '#cbd5e1', fontSize: 14, marginTop: 12, lineHeight: 1.7 }}>
          {content.enriched_description || content.description}
        </p>
        <a
          href={appUrl}
          style={{
            display: 'block',
            textAlign: 'center',
            marginTop: 24,
            padding: '14px 0',
            background: '#6366f1',
            borderRadius: 9999,
            color: '#fff',
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          💎 こういう「知らないけど面白い」をスワイプで発掘する
        </a>

        <Comments contentId={content.id} />
      </div>
    </main>
  );
}
