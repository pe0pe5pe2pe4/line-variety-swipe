'use client';
import { useEffect, useState } from 'react';
import SwipeCard from '@/components/SwipeCard';

type Content = {
  id: string;
  title: string;
  description: string;
  thumbnail_url: string;
  vod_affiliate_url: string;
};

const DUMMY_USER_ID = 'test-user-001';

export default function Home() {
  const [contents, setContents] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/contents?user_id=${DUMMY_USER_ID}`)
      .then((r) => r.json())
      .then((data) => {
        setContents(data);
        setLoading(false);
      });
  }, []);

  const handleSwipe = async (direction: 'left' | 'right', content: Content) => {
    if (direction === 'right' && content.vod_affiliate_url) {
      window.open(content.vod_affiliate_url, '_blank');
    }

    await fetch('/api/swipes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: DUMMY_USER_ID,
        content_id: content.id,
        direction,
      }),
    });

    setContents((prev) => prev.filter((c) => c.id !== content.id));
  };

  if (loading) return (
    <main className="flex items-center justify-center h-screen">
      <p className="text-gray-400">読み込み中...</p>
    </main>
  );

  if (contents.length === 0) return (
    <main className="flex items-center justify-center h-screen">
      <p className="text-gray-400">番組がありません</p>
    </main>
  );

  return (
    <main className="flex items-center justify-center h-screen bg-gray-100">
      <div className="relative w-80 h-96">
        {contents.slice(0, 3).reverse().map((content) => (
          <SwipeCard
            key={content.id}
            content={content}
            onSwipe={(dir) => handleSwipe(dir, content)}
          />
        ))}
      </div>
    </main>
  );
}