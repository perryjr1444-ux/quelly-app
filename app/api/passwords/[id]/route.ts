import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ApiResponse } from '@/types/api';
import type { DisposablePassword } from '@/types/passwords';

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

  const { data, error } = await supabase
    .from('disposable_passwords')
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

  if (!data) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'PASSWORD_NOT_FOUND', message: 'Password not found or already used' } },
      { status: 404 }
    );
  }

  return NextResponse.json<ApiResponse<DisposablePassword>>({ ok: true, data });
}
