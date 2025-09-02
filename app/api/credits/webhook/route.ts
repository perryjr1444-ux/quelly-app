import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createHmac } from 'crypto';

export const runtime = 'nodejs';

function verifyCoinbase(req: NextRequest, body: string): boolean {
  const secret = process.env.COINBASE_COMMERCE_WEBHOOK_SECRET || '';
  const signature = req.headers.get('x-cc-webhook-signature') || '';
  if (!secret || !signature) return false;
  const hmac = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return hmac === signature;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyCoinbase(req, raw)) return NextResponse.json({ ok: false }, { status: 400 });
  const payload = JSON.parse(raw);
  const event = payload?.event;
  if (!event) return NextResponse.json({ ok: false }, { status: 400 });
  if (event.type !== 'charge:confirmed') return NextResponse.json({ ok: true });

  const metadata = event?.data?.metadata || {};
  const userId = metadata.user_id as string | undefined;
  const credits = Number(metadata.credits || 0);
  if (!userId || !credits) return NextResponse.json({ ok: false }, { status: 400 });

  const supabase = createAdminClient();
  // Ensure account exists
  await supabase.from('credits_accounts').upsert({ user_id: userId, balance: 0 });
  // Initialize RPC permissions if needed
  try { await supabase.rpc('spend_credit', { p_user_id: userId, p_reason: 'noop' }); } catch {}
  await supabase
    .from('credits_accounts')
    .update({ balance: (await (async () => { const { data } = await supabase.from('credits_accounts').select('balance').eq('user_id', userId).maybeSingle(); return (data?.balance || 0) + credits; })()) })
    .eq('user_id', userId);
  await supabase.from('credits_transactions').insert({ user_id: userId, delta: credits, reason: 'crypto_purchase' });

  return NextResponse.json({ ok: true });
}


