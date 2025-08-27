import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { randomBytes } from 'crypto';
import type { ApiResponse } from '@/types/api';
import type { DisposablePassword } from '@/types/passwords';

// Helper to generate a strong random password
function generatePassword(length = 16) {
  return randomBytes(length).toString('base64url').slice(0, length);
}

// GET /api/passwords → list user’s passwords
export async function GET(_req: NextRequest) {
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
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  return NextResponse.json<ApiResponse<DisposablePassword[]>>({ ok: true, data: data ?? [] });
}

// POST /api/passwords → generate + insert a new one
export async function POST(_req: NextRequest) {
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

  const password = generatePassword();

  const { data, error } = await supabase
    .from('disposable_passwords')
    .insert([{ user_id: user.id, password, status: 'active' }])
    .select()
    .single();

  if (error) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  return NextResponse.json<ApiResponse<DisposablePassword>>({ ok: true, data: data! });
}
