import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ApiResponse } from '@/types/api';
import { rateLimit } from '@/lib/ratelimit';

export async function POST(req: NextRequest) {
  if (!rateLimit(req, 'auth-magic', 5, 60_000)) {
    return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 });
  }
  const supabase = createClient();
  const { email } = await req.json();
  if (!email || typeof email !== 'string') {
    return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'BAD_REQUEST', message: 'email required' } }, { status: 400 });
  }
  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/dashboard`;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
  if (error) {
    return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'AUTH_ERROR', message: error.message } }, { status: 500 });
  }
  return NextResponse.json<ApiResponse<{ email: string }>>({ ok: true, data: { email } });
}


