import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ApiResponse } from '@/types/api';
import { createHash, randomBytes } from 'crypto';
import { rateLimit } from '@/lib/ratelimit';

export async function POST(req: NextRequest) {
  if (!rateLimit(req, 'check-verify', 60, 60_000)) {
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
  const credId: string | undefined = typeof body.id === 'string' ? body.id : undefined;
  const secret: string | undefined = typeof body.secret === 'string' ? body.secret : undefined;
  const rotate: boolean = Boolean(body.rotate);

  if (!credId || !secret) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'id and secret required' } },
      { status: 400 }
    );
  }

  const presentedHash = createHash('sha256').update(secret).digest('hex');

  const { data: cred, error: credErr } = await supabase
    .from('check_credentials')
    .select('*')
    .eq('id', credId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (credErr || !cred) {
    try { await supabase.from('check_events').insert([{ cred_id: credId, event: 'failed' }]); } catch {}
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'NOT_FOUND', message: 'credential not found' } },
      { status: 404 }
    );
  }

  if (cred.expires_at && new Date(cred.expires_at) < new Date()) {
    try { await supabase.from('check_events').insert([{ cred_id: cred.id, event: 'failed' }]); } catch {}
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'EXPIRED', message: 'credential expired' } },
      { status: 400 }
    );
  }

  if (presentedHash !== cred.hash) {
    try { await supabase.from('check_events').insert([{ cred_id: cred.id, event: 'failed' }]); } catch {}
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'INVALID', message: 'invalid secret' } },
      { status: 401 }
    );
  }

  try { await supabase.from('check_events').insert([{ cred_id: cred.id, event: 'verified' }]); } catch {}

  let rotatedSecret: string | undefined;
  if (rotate) {
    const newSecret = randomBytes(24).toString('base64url').slice(0, 24);
    const newHash = createHash('sha256').update(newSecret).digest('hex');
    await supabase
      .from('check_credentials')
      .update({ hash: newHash, version: (cred.version ?? 1) + 1 })
      .eq('id', cred.id)
      .eq('user_id', user.id)
      .eq('status', 'active');
    try { await supabase.from('check_events').insert([{ cred_id: cred.id, event: 'rotated' }]); } catch {}
    rotatedSecret = newSecret;
  }

  return NextResponse.json<ApiResponse<{ ok: true; rotatedSecret?: string }>>({ ok: true, data: { ok: true, rotatedSecret } });
}
