import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const secret = process.env.STRIPE_SECRET_KEY;
  const publicUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  if (!secret) return NextResponse.json({ ok: false, error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 });
  const stripe = new Stripe(secret);
  // Look up the user's stripe customer id
  const { data: billing } = await supabase
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', user?.id || '')
    .maybeSingle();
  const customerId = billing?.stripe_customer_id;
  if (!customerId) return NextResponse.json({ ok: false, error: 'Missing customer mapping' }, { status: 404 });
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${publicUrl}/dashboard` });
  return NextResponse.redirect(session.url, { status: 303 });
}


