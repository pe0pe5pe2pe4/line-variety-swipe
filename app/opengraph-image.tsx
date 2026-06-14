import { ImageResponse } from 'next/og';

// OGP / Twitter カード画像（summary_large_image 用 1200x630）
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'バラ推し';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0f172a, #1e1b4b)',
          color: '#fff',
        }}
      >
        <div style={{ fontSize: 120 }}>🎬</div>
        <div style={{ fontSize: 96, fontWeight: 900, marginTop: 12 }}>バラ推し</div>
        <div style={{ fontSize: 40, color: '#cbd5e1', marginTop: 16 }}>
          バラエティ番組・YouTube動画をスワイプで発見
        </div>
      </div>
    ),
    size
  );
}
