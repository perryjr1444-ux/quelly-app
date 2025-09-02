import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/types/api';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const session_id = url.searchParams.get('session_id');
    if (!session_id) {
      return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'BAD_REQUEST', message: 'session_id required' } }, { status: 400 });
    }
    const edge = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/otac-status?session_id=${encodeURIComponent(session_id)}`;
    const res = await fetch(edge, {
      headers: {
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'X-Internal-Auth': process.env.INTERNAL_FUNCTION_SECRET || '',
      }
    });
    const body = await res.text();
    return new NextResponse(body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'INTERNAL', message: String(err?.message || err) } }, { status: 500 });
  }
}


