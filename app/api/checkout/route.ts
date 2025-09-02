import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const secret = process.env.STRIPE_SECRET_KEY;
  let priceId = process.env.STRIPE_PRICE_ID;
  const publicUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  if (!secret) return NextResponse.json({ ok: false, error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 });
  if (!priceId) {
    // Fallback to billing_config if env not set
    const admin = (await import('@/lib/supabase/admin')).createAdminClient();
    const { data: cfg } = await admin.from('billing_config').select('price_id').eq('id', 'default').maybeSingle();
    priceId = cfg?.price_id || '';
  }
  if (!priceId) return NextResponse.json({ ok: false, error: 'Missing STRIPE_PRICE_ID' }, { status: 500 });
  const stripe = new Stripe(secret);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${publicUrl}/dashboard?upgraded=1`,
    cancel_url: `${publicUrl}/pricing?canceled=1`,
    client_reference_id: user?.id,
    customer_email: user?.email || undefined,
    allow_promotion_codes: true,
  });
  return NextResponse.redirect(session.url!, { status: 303 });
}


