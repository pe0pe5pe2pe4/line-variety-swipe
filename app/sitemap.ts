import type { MetadataRoute } from 'next';
import { supabase } from '@/lib/supabase';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://line-variety-swipe.vercel.app';

  let ids: string[] = [];
  try {
    const { data } = await supabase.from('contents').select('id').limit(1000);
    ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  } catch {
    ids = [];
  }

  return [
    { url: base, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    ...ids.map((id) => ({
      url: `${base}/show/${id}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
  ];
}
