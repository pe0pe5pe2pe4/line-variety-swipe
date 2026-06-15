import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // APIレスポンス等を gzip 圧縮（Vercel でも有効）
  compress: true,
  images: {
    // Next.js 16: qualities must be allow-listed explicitly
    qualities: [75],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/t/p/**',
      },
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
        pathname: '/**',
      },
      // YouTube サムネイル（i.ytimg.com / i9.ytimg.com など）
      {
        protocol: 'https',
        hostname: '**.ytimg.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
