This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Stripe（課金）テストモード

プレミアム（月額480円）の決済は Stripe Checkout を使用します。テストモードで動作確認するには、Vercel の環境変数にテストキーを設定してください。

- `STRIPE_SECRET_KEY` … `sk_test_...`
- `STRIPE_WEBHOOK_SECRET` … `whsec_...`（Stripe ダッシュボードで `/api/stripe-webhook` を登録して取得）
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` … `pk_test_...`

### テスト用カード番号

| 用途 | 番号 | 補足 |
| --- | --- | --- |
| 成功 | `4242 4242 4242 4242` | 有効期限は未来の任意日付・CVCは任意3桁 |
| 失敗（カード拒否） | `4000 0000 0000 9995` | 残高不足エラーを再現 |

`STRIPE_SECRET_KEY` が未設定の場合、`/api/create-checkout-session` は 503 と分かりやすいエラーメッセージを返し、クライアントはモックのプレミアム付与にフォールバックします。

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

## エラー監視（Sentry・任意）

`SENTRY_DSN`（クライアント送信用は `NEXT_PUBLIC_SENTRY_DSN`）を設定すると、クライアント・サーバー両方の未捕捉エラーと「遅いAPI」アラートが Sentry に送信されます（軽量実装・無料プランで利用可）。未設定時はコンソールログのみで動作します。

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
