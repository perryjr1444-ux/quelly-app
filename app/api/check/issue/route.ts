import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ApiResponse } from '@/types/api';
import { randomBytes, createHash } from 'crypto';
import { rateLimit } from '@/lib/ratelimit';

function generateCheckSecret(length = 24) {
  return randomBytes(length).toString('base64url').slice(0, length);
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, 'check-issue', 20, 60_000)) {
    return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 });
  }
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

  const body = await req.json().catch(() => ({}));
  const label: string | undefined = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : undefined;
  const expiresAt: string | undefined = typeof body.expires_at === 'string' ? body.expires_at : undefined;

  const secret = generateCheckSecret();
  const hash = createHash('sha256').update(secret).digest('hex');

  // Quotas: free vs pro based on entitlements
  let isPro = false;
  const { data: org } = await supabase.from('orgs').select('id').eq('owner_id', user.id).maybeSingle();
  if (org?.id) {
    const { data: ent } = await supabase.from('entitlements').select('plan').eq('org_id', org.id).maybeSingle();
    isPro = ent?.plan === 'pro';
  }
  if (!isPro) {
    const { count } = await supabase.from('check_credentials').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active');
    if ((count || 0) >= 3) {
      return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'QUOTA_EXCEEDED', message: 'Free plan limit reached' } }, { status: 402 });
    }
  }

  const { data, error } = await supabase
    .from('check_credentials')
    .insert([{ user_id: user.id, label, hash, status: 'active', expires_at: expiresAt ? new Date(expiresAt).toISOString() : null }])
    .select()
    .single();

  if (error) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  await supabase.from('check_events').insert([{ cred_id: data!.id, event: 'issued' }]);

  return NextResponse.json<ApiResponse<{ id: string; label?: string; secret: string }>>({ ok: true, data: { id: data!.id, label, secret } });
}
