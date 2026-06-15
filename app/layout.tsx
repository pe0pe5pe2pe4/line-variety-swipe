import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://line-variety-swipe.vercel.app";
const OG_TITLE = "バラ推し";
const OG_DESC = "バラエティ番組・YouTube動画をスワイプで発見";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: OG_TITLE,
  description: OG_DESC,
  appleWebApp: { capable: true, title: OG_TITLE, statusBarStyle: "black-translucent" },
  openGraph: {
    title: OG_TITLE,
    description: OG_DESC,
    url: SITE_URL,
    siteName: OG_TITLE,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESC,
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* YouTube 埋め込みの接続を事前に温めて、動画再生開始を速くする */}
        <link rel="preconnect" href="https://www.youtube.com" />
        <link rel="preconnect" href="https://i.ytimg.com" />
        <link rel="preconnect" href="https://www.google.com" />
        <link rel="preconnect" href="https://googleads.g.doubleclick.net" />
        <link rel="dns-prefetch" href="https://www.youtube.com" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
