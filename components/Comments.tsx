'use client';
import { useEffect, useState } from 'react';

type Comment = { id: string; text: string; created_at: string; name: string };

export default function Comments({ contentId }: { contentId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const load = () => {
    fetch(`/api/comments?content_id=${encodeURIComponent(contentId)}`)
      .then((r) => r.json())
      .then((d) => setComments(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    // LINE 環境ならユーザーIDを取得（任意・無ければ匿名投稿）
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (liffId && liffId !== 'dummy') {
      import('@/lib/liff')
        .then(({ initializeLiff }) => initializeLiff())
        .then((p) => { if (p) setUserId(p.userId); })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId]);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setPosting(true);
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, content_id: contentId, text: t }),
      });
      if (res.ok) {
        setText('');
        load();
      }
    } finally {
      setPosting(false);
    }
  };

  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>コメント</h2>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 200))}
          maxLength={200}
          placeholder="一言コメント（200文字まで）"
          style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid #475569', background: '#1e293b', color: '#fff' }}
        />
        <button
          onClick={submit}
          disabled={posting || !text.trim()}
          style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, opacity: posting ? 0.6 : 1 }}
        >
          投稿
        </button>
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {comments.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: 13 }}>まだコメントはありません</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} style={{ background: '#1e293b', borderRadius: 10, padding: 10 }}>
              <p style={{ color: '#cbd5e1', fontSize: 14 }}>{c.text}</p>
              <p style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>{c.name}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
