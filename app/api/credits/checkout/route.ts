import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(_req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 });

  const billingDisabled = process.env.BILLING_DISABLED === '1' || process.env.BILLING_DISABLED === 'true';
  if (billingDisabled) return NextResponse.json({ ok: false, error: 'BILLING_DISABLED' }, { status: 400 });

  const provider = (process.env.PAYMENTS_PROVIDER || 'stripe').toLowerCase();
  const publicUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  if (provider === 'stripe') {
    // For now, route users to pricing; Stripe credits SKU can be added later
    return NextResponse.redirect(`${publicUrl}/pricing?buy=credits`, { status: 303 });
  }

  if (provider === 'crypto') {
    const apiKey = process.env.COINBASE_COMMERCE_API_KEY;
    const qty = Number(process.env.CREDITS_PACKAGE_QUANTITY || '100');
    const price = Number(process.env.CREDITS_PRICE_USD || '9');
    if (!apiKey) return NextResponse.json({ ok: false, error: 'MISSING_CRYPTO_CONFIG' }, { status: 500 });

    const payload = {
      name: 'Hashword Credits',
      description: `${qty} rotation credits`,
      pricing_type: 'fixed_price',
      local_price: { amount: price.toFixed(2), currency: 'USD' },
      metadata: { user_id: user.id, credits: qty },
      redirect_url: `${publicUrl}/dashboard?credits=1`,
      cancel_url: `${publicUrl}/pricing?canceled=1`,
    } as any;

    const res = await fetch('https://api.commerce.coinbase.com/charges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CC-Api-Key': apiKey,
        'X-CC-Version': '2018-03-22',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: 'CRYPTO_CHECKOUT_FAILED' }, { status: 500 });
    const json = await res.json();
    const url = json?.data?.hosted_url;
    if (!url) return NextResponse.json({ ok: false, error: 'CRYPTO_CHECKOUT_FAILED' }, { status: 500 });
    return NextResponse.redirect(url, { status: 303 });
  }

  return NextResponse.json({ ok: false, error: 'UNSUPPORTED_PROVIDER' }, { status: 400 });
}


