import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ApiResponse } from '@/types/api';
import { rateLimit } from '@/lib/ratelimit';

export async function POST(req: NextRequest) {
  if (!rateLimit(req, 'check-revoke', 30, 60_000)) {
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
  if (!credId) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'BAD_REQUEST', message: 'id is required' } },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from('check_credentials')
    .update({ status: 'revoked' })
    .eq('id', credId)
    .eq('user_id', user.id)
    .eq('status', 'active');

  if (error) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  try {
    await supabase.from('check_events').insert([{ cred_id: credId, event: 'revoked' }]);
  } catch {}

  return NextResponse.json<ApiResponse<{ id: string }>>({ ok: true, data: { id: credId } });
}
