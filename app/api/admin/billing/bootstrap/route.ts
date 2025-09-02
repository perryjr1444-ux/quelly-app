import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Restrict execution: only when explicitly enabled
  if (process.env.ADMIN_BOOTSTRAP_ENABLED !== '1') {
    return NextResponse.json({ ok: false, error: 'Bootstrap disabled' }, { status: 403 });
  }
  // Optional: restrict to development unless explicitly forced
  if (process.env.NODE_ENV !== 'development' && process.env.ALLOW_PROD_BOOTSTRAP !== '1') {
    return NextResponse.json({ ok: false, error: 'Not allowed in production' }, { status: 403 });
  }

  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token !== process.env.ADMIN_BOOTSTRAP_SECRET) return NextResponse.json({ ok: false }, { status: 401 });

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) return NextResponse.json({ ok: false, error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 });
  const publicUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const stripe = new Stripe(stripeSecret);

  const name = 'PoofPass Pro';
  const products = await stripe.products.list({ active: true, limit: 100 });
  let product = products.data.find(p => p.name === name);
  if (!product) {
    product = await stripe.products.create({ name });
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  let price = prices.data.find(pr => pr.recurring?.interval === 'month' && pr.unit_amount === 900);
  if (!price) {
    price = await stripe.prices.create({ product: product.id, unit_amount: 900, currency: 'usd', recurring: { interval: 'month' } });
  }

  const whUrl = `${publicUrl}/api/stripe/webhook`;
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  let webhook = endpoints.data.find(e => e.url === whUrl && e.status === 'enabled');
  if (!webhook) {
    webhook = await stripe.webhookEndpoints.create({
      url: whUrl,
      enabled_events: ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'],
    });
  }

  const supabase = createAdminClient();
  await supabase
    .from('billing_config')
    .upsert({ id: 'default', product_id: product.id, price_id: price.id, webhook_endpoint_id: webhook.id, webhook_secret: webhook.secret || null });

  // Do not return webhook secret over the wire
  return NextResponse.json({ ok: true, data: { product: product.id, price: price.id, webhookId: webhook.id } });
}


