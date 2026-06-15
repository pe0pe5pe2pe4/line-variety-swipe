import { NextResponse } from 'next/server';
import { getStripe, PREMIUM_AMOUNT_JPY } from '@/lib/stripe';
import { rateLimit, rateLimited } from '@/lib/rate-limit';

export const maxDuration = 25;

// 月額480円のサブスク用 Stripe Checkout セッションを作成する。
// POST { user_id }
export async function POST(request: Request) {
  const rl = rateLimit(request);
  if (!rl.ok) return rateLimited(rl.retryAfter);

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json(
      {
        error: 'STRIPE_SECRET_KEY が未設定です。Vercel の環境変数に Stripe のシークレットキー（テストは sk_test_...）を設定してください。',
        code: 'stripe_not_configured',
      },
      { status: 503 }
    );
  }

  let body: { user_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const userId = body.user_id;
  if (!userId) return NextResponse.json({ error: 'user_id required' }, { status: 400 });

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'jpy',
            unit_amount: PREMIUM_AMOUNT_JPY,
            recurring: { interval: 'month' },
            product_data: { name: 'バラ推し プレミアム' },
          },
        },
      ],
      client_reference_id: userId,
      metadata: { user_id: userId },
      success_url: `${origin}/?upgraded=true`,
      cancel_url: `${origin}/`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
