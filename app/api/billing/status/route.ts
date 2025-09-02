import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createClient();
  const billingDisabled = process.env.BILLING_DISABLED === '1' || process.env.BILLING_DISABLED === 'true';
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ ok: false, error: 'NOT_AUTHENTICATED' }, { status: 401 });

  let plan: 'free' | 'pro' = 'free';
  const { data: org } = await supabase.from('orgs').select('id').eq('owner_id', user.id).maybeSingle();
  if (org?.id) {
    const { data: ent } = await supabase.from('entitlements').select('plan').eq('org_id', org.id).maybeSingle();
    if (ent?.plan === 'pro') plan = 'pro';
  }

  const { data: billing } = await supabase
    .from('billing_customers')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  // Credits balance for low-credits toasts
  const { data: acct } = await supabase
    .from('credits_accounts')
    .select('balance')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({ ok: true, data: { plan, customerId: billing?.stripe_customer_id || null, billingEnabled: !billingDisabled, credits: acct?.balance ?? 0 } });
}


