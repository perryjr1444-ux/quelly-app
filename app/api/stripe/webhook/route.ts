import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_SECRET_KEY;
  let whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ ok: false }, { status: 400 });
  const stripe = new Stripe(secret);
  const payload = await req.text();
  const sig = req.headers.get('stripe-signature') as string;
  if (!whSecret) {
    const supa = createAdminClient();
    const { data: cfg } = await supa.from('billing_config').select('webhook_secret').eq('id', 'default').maybeSingle();
    whSecret = cfg?.webhook_secret || '';
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, sig, whSecret || '');
  } catch (err) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const supabase = createAdminClient();
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = session.customer as string;
      const userId = (session.client_reference_id as string) || '';
      let resolvedUserId = userId;
      if (!resolvedUserId) {
        const email = session.customer_details?.email || session.customer_email || '';
        if (email) {
          const { data: users } = await supabase.auth.admin.listUsers();
          const user = users.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
          if (user) resolvedUserId = user.id;
        }
      }
      if (!resolvedUserId) break;
      // Ensure org exists for user (owner)
      const { data: org } = await supabase.from('orgs').select('*').eq('owner_id', resolvedUserId).maybeSingle();
      let orgId = org?.id;
      if (!orgId) {
        const { data: newOrg } = await supabase.from('orgs').insert({ owner_id: resolvedUserId, name: 'Personal' }).select().single();
        orgId = newOrg?.id;
        if (orgId) {
          await supabase.from('org_members').insert({ org_id: orgId, user_id: resolvedUserId, role: 'owner' });
        }
      }
      if (orgId) {
        await supabase.from('entitlements').upsert({ org_id: orgId, plan: 'pro' });
      }
      // Upsert billing customer mapping
      await supabase
        .from('billing_customers')
        .upsert({ user_id: resolvedUserId, org_id: orgId, stripe_customer_id: customerId });
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const status = subscription.status;
      const { data: mapping } = await supabase
        .from('billing_customers')
        .select('*')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();
      if (!mapping) break;
      const plan = status === 'active' || status === 'trialing' ? 'pro' : 'free';
      if (mapping.org_id) {
        await supabase.from('entitlements').upsert({ org_id: mapping.org_id, plan });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const { data: mapping } = await supabase
        .from('billing_customers')
        .select('*')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();
      if (!mapping) break;
      if (mapping.org_id) {
        await supabase.from('entitlements').upsert({ org_id: mapping.org_id, plan: 'free' });
      }
      break;
    }
  }
  return NextResponse.json({ ok: true });
}

// Note: ensure Node.js runtime for raw body parsing/signature verification.


