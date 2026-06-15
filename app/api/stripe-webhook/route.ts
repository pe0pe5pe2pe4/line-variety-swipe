import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';

export const maxDuration = 25;

// Stripe Webhook。署名検証のため raw body を使う。
// - checkout.session.completed → /api/upgrade-premium を呼んで is_premium=true
// - customer.subscription.deleted → is_premium=false
export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const sig = request.headers.get('stripe-signature') ?? '';
  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    return NextResponse.json({ error: `signature: ${String(e)}` }, { status: 400 });
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session;
      const userId = s.client_reference_id ?? (s.metadata?.user_id as string | undefined);
      const customer = typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null;

      if (userId) {
        // 後の解約イベントで顧客→ユーザーを引けるよう customer id を保存（列が無ければ無視）
        if (customer) {
          await supabase.from('users').update({ stripe_customer_id: customer }).eq('line_user_id', userId);
        }
        // 決済成功 → プレミアム付与（/api/upgrade-premium を呼ぶ）
        await fetch(`${origin}/api/upgrade-premium`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId }),
        });
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
      if (customer) {
        await supabase
          .from('users')
          .update({ is_premium: false, premium_until: null })
          .eq('stripe_customer_id', customer);
      }
    }
  } catch (e) {
    // 処理失敗でも 200 を返すと Stripe が再送しないため、500 で再送を促す
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
