import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/types/api';

export async function POST(req: NextRequest) {
  try {
    const { session_id, code } = await req.json().catch(() => ({}));
    if (!session_id || !code) {
      return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'BAD_REQUEST', message: 'session_id and code required' } }, { status: 400 });
    }
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/otac-claim`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'X-Internal-Auth': process.env.INTERNAL_FUNCTION_SECRET || '',
      },
      body: JSON.stringify({ session_id, code }),
    });
    const body = await res.text();
    return new NextResponse(body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'INTERNAL', message: String(err?.message || err) } }, { status: 500 });
  }
}


