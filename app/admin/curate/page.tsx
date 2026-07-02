'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { extractYouTubeId } from '@/lib/types';

// 人力キュレーション画面（proxy.ts の Basic 認証で保護）。
// 発掘メディアの生死は初期の目利きで決まる — 動画をその場で再生して
// 「面白い / 微妙」を高速判定し、結果を推薦エンジンに直結させる。
// キーボード: F=面白い / J=微妙 / S=スキップ

type Item = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  youtube_url: string | null;
  preview_youtube_url: string | null;
  channel_name: string | null;
  content_type: string | null;
  genre: string | null;
  yt_view_count: number | null;
  yt_subscriber_count: number | null;
};

function fmt(n: number | null | undefined): string {
  if (typeof n !== 'number' || n <= 0) return '—';
  if (n >= 10_000) return `${Math.round(n / 10_000)}万`;
  return n.toLocaleString('en-US');
}

export default function CuratePage() {
  const [queue, setQueue] = useState<Item[]>([]);
  const [remaining, setRemaining] = useState(0);
  const [type, setType] = useState<'youtube' | 'tv_show' | 'tver' | 'all'>('youtube');
  const [judged, setJudged] = useState({ good: 0, bad: 0 });
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const busy = useRef(false);

  const load = useCallback(async (t: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/curate?type=${t}&limit=20`);
      const json = await res.json();
      if (json.error) {
        setMsg(`${json.error}${json.hint ? ` / ${json.hint}` : ''}`);
        setQueue([]);
      } else {
        setQueue(json.items ?? []);
        setRemaining(json.remaining ?? 0);
        setMsg('');
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(type);
  }, [type, load]);

  const current = queue[0] ?? null;

  const advance = useCallback(() => {
    setQueue((q) => {
      const next = q.slice(1);
      if (next.length === 0) void load(type);
      return next;
    });
  }, [load, type]);

  const judge = useCallback(
    async (verdict: 'good' | 'bad') => {
      if (!current || busy.current) return;
      busy.current = true;
      try {
        const res = await fetch('/api/admin/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'curate', content_id: current.id, verdict }),
        });
        const json = await res.json();
        if (json.error) {
          setMsg(`保存失敗: ${json.error}${json.hint ? ` / ${json.hint}` : ''}`);
          return;
        }
        setJudged((j) => ({ ...j, [verdict]: j[verdict] + 1 }));
        setRemaining((r) => Math.max(0, r - 1));
        advance();
      } catch (e) {
        setMsg(`保存失敗: ${String(e)}`);
      } finally {
        busy.current = false;
      }
    },
    [current, advance]
  );

  // キーボードショートカット（入力欄フォーカス時は無効）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'f' || e.key === 'F') void judge('good');
      else if (e.key === 'j' || e.key === 'J') void judge('bad');
      else if (e.key === 's' || e.key === 'S') advance();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [judge, advance]);

  const ytId = current
    ? extractYouTubeId(current.youtube_url) ?? extractYouTubeId(current.preview_youtube_url)
    : null;
  const ratio =
    current &&
    typeof current.yt_view_count === 'number' &&
    current.yt_view_count > 0 &&
    typeof current.yt_subscriber_count === 'number' &&
    current.yt_subscriber_count > 0
      ? current.yt_view_count / current.yt_subscriber_count
      : 0;

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui', maxWidth: 640, margin: '0 auto', color: '#e2e8f0', background: '#0f172a', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: 20, fontWeight: 900 }}>🎯 目利きキュレーション</h1>
        <a href="/admin" style={{ color: '#818cf8', fontSize: 13 }}>← 管理画面へ</a>
      </div>
      <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 12px' }}>
        「面白い」はコールドスタート先頭＋発掘枠の最優先に。「微妙」は表示対象から外れます。
        キーボード: <b>F</b>=面白い / <b>J</b>=微妙 / <b>S</b>=スキップ
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, padding: '6px 10px' }}
        >
          <option value="youtube">YouTube</option>
          <option value="tver">TVer</option>
          <option value="tv_show">番組</option>
          <option value="all">すべて</option>
        </select>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          未判定 {remaining} 件 / このセッション ⭐{judged.good} 👎{judged.bad}
        </span>
      </div>

      {msg && (
        <p style={{ background: '#7f1d1d', color: '#fecaca', padding: 10, borderRadius: 8, fontSize: 12, wordBreak: 'break-all' }}>{msg}</p>
      )}

      {loading && queue.length === 0 ? (
        <p>読み込み中...</p>
      ) : !current ? (
        <p style={{ padding: 24, textAlign: 'center' }}>🎉 未判定のコンテンツはありません</p>
      ) : (
        <div style={{ background: '#1e293b', borderRadius: 16, overflow: 'hidden', border: '1px solid #334155' }}>
          {ytId ? (
            <iframe
              key={current.id}
              style={{ width: '100%', aspectRatio: '16/9', border: 0, display: 'block' }}
              src={`https://www.youtube.com/embed/${ytId}?autoplay=1&mute=0&playsinline=1&rel=0&modestbranding=1`}
              title={current.title}
              allow="autoplay; encrypted-media"
            />
          ) : current.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.thumbnail_url} alt={current.title} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />
          ) : null}

          <div style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6, fontSize: 11 }}>
              {current.genre && <span style={{ background: '#312e81', padding: '2px 8px', borderRadius: 999 }}>#{current.genre}</span>}
              <span style={{ background: '#334155', padding: '2px 8px', borderRadius: 999 }}>{current.content_type ?? 'tv_show'}</span>
              <span style={{ background: '#334155', padding: '2px 8px', borderRadius: 999 }}>▶ {fmt(current.yt_view_count)}回</span>
              <span style={{ background: '#334155', padding: '2px 8px', borderRadius: 999 }}>👥 登録 {fmt(current.yt_subscriber_count)}</span>
              {ratio >= 3 && (
                <span style={{ background: '#86198f', padding: '2px 8px', borderRadius: 999 }}>💎 登録者の{Math.round(ratio)}倍再生</span>
              )}
            </div>
            <h2 style={{ fontSize: 15, fontWeight: 800, lineHeight: 1.4 }}>{current.title}</h2>
            {current.channel_name && <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{current.channel_name}</p>}
            {current.description && (
              <p style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6, lineHeight: 1.6, maxHeight: 60, overflow: 'hidden' }}>{current.description}</p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                onClick={() => void judge('bad')}
                style={{ flex: 1, padding: '14px 0', borderRadius: 999, border: 0, background: '#475569', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}
              >
                👎 微妙 (J)
              </button>
              <button
                onClick={advance}
                style={{ width: 90, padding: '14px 0', borderRadius: 999, border: '1px solid #475569', background: 'transparent', color: '#94a3b8', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                スキップ
              </button>
              <button
                onClick={() => void judge('good')}
                style={{ flex: 1, padding: '14px 0', borderRadius: 999, border: 0, background: 'linear-gradient(90deg,#f59e0b,#f97316)', color: '#000', fontWeight: 900, fontSize: 15, cursor: 'pointer' }}
              >
                ⭐ 面白い (F)
              </button>
            </div>
          </div>
        </div>
      )}
      <p style={{ fontSize: 11, color: '#64748b', marginTop: 12 }}>
        次のカード: {queue.slice(1, 4).map((q) => q.title).join(' / ') || '—'}
      </p>
    </main>
  );
}
