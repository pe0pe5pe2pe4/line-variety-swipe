This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Web Push（プッシュ通知）の VAPID 鍵生成

毎日18時JST（Cron `0 9 * * *`）に `/api/send-notifications` がおすすめ番組TOP3を配信します。
事前に VAPID 鍵を生成して環境変数に設定してください。

```bash
npx web-push generate-vapid-keys
```

出力された Public/Private キーを Vercel の環境変数に設定します:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` … Public Key（クライアントの購読登録に使用）
- `VAPID_PUBLIC_KEY` … Public Key（サーバー送信用・上と同値でOK）
- `VAPID_PRIVATE_KEY` … Private Key
- `VAPID_SUBJECT` …（任意）`mailto:you@example.com`

`push_subscriptions` テーブルが必要です（前段のSQL参照）。

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
