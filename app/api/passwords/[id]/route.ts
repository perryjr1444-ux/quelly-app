import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ApiResponse } from '@/types/api';
// After pointer migration, this route marks reference as used and triggers rotation in vault via edge function

// PATCH /api/passwords/[id] → mark as used
export async function PATCH(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'NOT_AUTHENTICATED', message: 'User not authenticated' } },
      { status: 401 }
    );
  }

  // Enforce free plan rotation cap: allow at most 10 rotations ("used" events) for non-pro users
  let isPro = false;
  const { data: org } = await supabase.from('orgs').select('id').eq('owner_id', user.id).maybeSingle();
  if (org?.id) {
    const { data: ent } = await supabase.from('entitlements').select('plan').eq('org_id', org.id).maybeSingle();
    isPro = ent?.plan === 'pro';
  }
  if (!isPro) {
    const { count: usedCount } = await supabase
      .from('password_events')
      .select('*', { count: 'exact', head: true })
      .eq('event', 'used');
    if ((usedCount || 0) >= 10) {
      return NextResponse.json<ApiResponse<null>>(
        { ok: false, error: { code: 'QUOTA_EXCEEDED', message: 'Rotation limit reached on free plan' } },
        { status: 402 }
      );
    }
  }

  // For paying customers offering pay-per-rotate: if plan is pro (or above) and we adopt credits, optionally spend a credit
  // This allows "pay per rotate" in addition to subscription, only when user has credits available
  if (isPro) {
    // Attempt to spend a credit; if no credits, we proceed (subscription covers usage). If you want strict pay-per-rotate, enforce failure here.
    try { await supabase.rpc('spend_credit', { p_user_id: user.id, p_reason: 'rotate' }); } catch {}
  }

  const { data: ref, error } = await supabase
    .from('password_references')
    .update({ status: 'used' })
    .eq('id', params.id)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .select()
    .single();

  if (error) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  if (!ref) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'PASSWORD_NOT_FOUND', message: 'Password not found or already used' } },
      { status: 404 }
    );
  }

  // Best-effort log event and rotate to a new password
  if (ref?.id) {
    try { await supabase.from('password_events').insert([{ password_id: ref.id, event: 'used' }]); } catch {}
    // Trigger rotation by calling vault-store with same user_id and label; it will create next version and upsert reference
    const edgeUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/vault-store`;
    await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'X-Internal-Auth': process.env.INTERNAL_FUNCTION_SECRET || '',
      },
      body: JSON.stringify({ user_id: user.id, label: (ref as any).label ?? null }),
    }).then(async () => { try { await supabase.from('password_events').insert([{ password_id: ref.id, event: 'rotated' }]); } catch {} }).catch(() => {});
  }

  return NextResponse.json<ApiResponse<any>>({ ok: true, data: ref });
}
