import { NextRequest, NextResponse } from 'next/server';
import type { ApiResponse } from '@/types/api';

export async function POST(_req: NextRequest) {
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/otac-issue`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'X-Internal-Auth': process.env.INTERNAL_FUNCTION_SECRET || '',
      },
      body: JSON.stringify({ user_id: 'anonymous', scope: { login: true } }),
    });
    const body = await res.text();
    return new NextResponse(body, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch (err: any) {
    return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'INTERNAL', message: String(err?.message || err) } }, { status: 500 });
  }
}


