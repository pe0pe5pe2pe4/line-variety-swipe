import type { Metadata } from 'next';
import { supabase } from '@/lib/supabase';
import { getThumbnailSrc, hasValidThumbnail, type Content } from '@/lib/types';

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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={getThumbnailSrc(content.thumbnail_url)}
          alt={content.title}
          style={{ width: '100%', borderRadius: 16, aspectRatio: '16/9', objectFit: 'cover', background: '#334155' }}
        />
        <h1 style={{ fontSize: 24, fontWeight: 900, marginTop: 16 }}>{content.title}</h1>
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
          バラ推しで他の番組も見る
        </a>
      </div>
    </main>
  );
}
