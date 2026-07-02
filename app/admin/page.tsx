'use client';
import { useEffect, useState } from 'react';

type ContentRow = {
  id: string;
  title: string;
  genre: string;
  content_type: string;
  swipes: number;
  likes: number;
  likeRate: number | null;
  hidden: boolean;
};
type Overview = {
  totals: { users: number; swipes: number; clicks: number; contents: number };
  contents: ContentRow[];
};
type Analytics = {
  dau: number;
  mau: number;
  avgSessionSec: number;
  retention: { d1: number | null; d7: number | null; d30: number | null };
  conversionRate: number;
  affiliateClickRate: number;
  premiumUsers: number;
  totalUsers: number;
};

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [msg, setMsg] = useState('');
  const [service, setService] = useState('unext');
  const [baseUrl, setBaseUrl] = useState('');

  const load = () => {
    fetch('/api/admin/overview')
      .then((r) => r.json())
      .then((d) => setData(d?.error ? null : d))
      .catch(() => setData(null));
    fetch('/api/admin/analytics')
      .then((r) => r.json())
      .then((d) => setAnalytics(d?.error ? null : d))
      .catch(() => setAnalytics(null));
  };
  useEffect(load, []);

  const action = async (payload: Record<string, unknown>, label: string) => {
    setMsg(`${label} 実行中...`);
    try {
      const res = await fetch('/api/admin/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      setMsg(`${label}: ${JSON.stringify(json).slice(0, 200)}`);
      if (payload.type === 'hide' || payload.type === 'unhide') load();
    } catch (e) {
      setMsg(`${label} 失敗: ${String(e)}`);
    }
  };

  const jobs = ['enrich-contents', 'ingest-youtube', 'ingest-tver', 'ingest-wikipedia', 'backfill-genre', 'dedupe', 'backfill-yt-views', 'grow-discovery', 'find-previews', 'hunt-gems'];

  return (
    <main style={{ padding: 16, fontFamily: 'system-ui', maxWidth: 900, margin: '0 auto' }}>
      <h1>バラ推し 管理画面</h1>
      <p style={{ margin: '8px 0 16px' }}>
        <a
          href="/admin/curate"
          style={{ display: 'inline-block', padding: '10px 18px', background: '#f59e0b', color: '#000', borderRadius: 999, fontWeight: 800, textDecoration: 'none' }}
        >
          🎯 目利きキュレーション（動画を見て面白い/微妙を判定）
        </a>
      </p>
      {!data ? (
        <p>読み込み中...</p>
      ) : (
        <>
          {analytics && (
            <section style={{ margin: '12px 0' }}>
              <h2>アナリティクス</h2>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <Stat label="DAU" value={analytics.dau} />
                <Stat label="MAU" value={analytics.mau} />
                <Stat label="平均セッション(秒)" value={analytics.avgSessionSec} />
                <Stat label="翌日リテンション(%)" value={analytics.retention.d1 ?? 0} />
                <Stat label="7日リテンション(%)" value={analytics.retention.d7 ?? 0} />
                <Stat label="30日リテンション(%)" value={analytics.retention.d30 ?? 0} />
                <Stat label="プレミアム転換率(%)" value={analytics.conversionRate} />
                <Stat label="アフィリクリック率(%)" value={analytics.affiliateClickRate} />
              </div>
            </section>
          )}

          <section style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '12px 0' }}>
            <Stat label="ユーザー数" value={data.totals.users} />
            <Stat label="スワイプ数" value={data.totals.swipes} />
            <Stat label="クリック数" value={data.totals.clicks} />
            <Stat label="コンテンツ数" value={data.totals.contents} />
          </section>

          <section style={{ margin: '12px 0' }}>
            <h2>手動実行</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {jobs.map((job) => (
                <button key={job} onClick={() => action({ type: 'run', job, query: job === 'ingest-tver' ? 'limit=5&offset=0' : '' }, job)}>
                  {job}
                </button>
              ))}
            </div>
          </section>

          <section style={{ margin: '12px 0' }}>
            <h2>アフィリエイト一括設定</h2>
            <select value={service} onChange={(e) => setService(e.target.value)}>
              <option value="unext">unext</option>
              <option value="hulu">hulu</option>
              <option value="amazon">amazon</option>
            </select>{' '}
            <input
              placeholder="base_url（末尾に番組名が付与されます）"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              style={{ width: 360 }}
            />{' '}
            <button onClick={() => action({ type: 'set-affiliate', service, base_url: baseUrl }, 'set-affiliate')}>
              設定
            </button>
          </section>

          {msg && <p style={{ background: '#eef', padding: 8, fontSize: 12 }}>{msg}</p>}

          <section style={{ margin: '12px 0' }}>
            <h2>コンテンツ一覧（スワイプ数順）</h2>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #ccc' }}>
                  <th>タイトル</th>
                  <th>ジャンル</th>
                  <th>種別</th>
                  <th>スワイプ</th>
                  <th>いいね率</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.contents.map((c) => (
                  <tr key={c.id} style={{ borderBottom: '1px solid #eee', opacity: c.hidden ? 0.4 : 1 }}>
                    <td>{c.title}</td>
                    <td>{c.genre}</td>
                    <td>{c.content_type}</td>
                    <td>{c.swipes}</td>
                    <td>{c.likeRate === null ? '-' : `${c.likeRate}%`}</td>
                    <td>
                      {c.hidden ? (
                        <button onClick={() => action({ type: 'unhide', content_id: c.id }, '再表示')}>再表示</button>
                      ) : (
                        <button onClick={() => action({ type: 'hide', content_id: c.id }, '非表示')}>非表示</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: '8px 16px' }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
    </div>
  );
}
