import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ApiResponse } from '@/types/api';
import { cache } from '@/lib/cache/redis';

// GET /api/passwords/events?password_id=...
export async function GET(req: Request) {
  const supabase = createClient();
  const { searchParams } = new URL(req.url);
  const passwordId = searchParams.get('password_id');

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

  if (!passwordId) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'MISSING_PASSWORD_ID', message: 'password_id is required' } },
      { status: 400 }
    );
  }

  // Ensure the password belongs to the user
  const { data: pw, error: pwErr } = await supabase
    .from('disposable_passwords')
    .select('id')
    .eq('id', passwordId)
    .eq('user_id', user.id)
    .single();

  if (pwErr || !pw) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'PASSWORD_NOT_FOUND', message: 'Password not found' } },
      { status: 404 }
    );
  }

  const cacheKey = `passwords:${user.id}:events:${passwordId}`;
  const cached = await cache.get<any[]>(cacheKey);
  if (cached) {
    return NextResponse.json<ApiResponse<any[]>>({ ok: true, data: cached });
  }

  const { data, error } = await supabase
    .from('password_events')
    .select('*')
    .eq('password_id', passwordId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  await cache.set(cacheKey, data ?? [], { ttl: 30, tags: [`passwords:${user.id}`] });
  return NextResponse.json<ApiResponse<any[]>>({ ok: true, data: data ?? [] });
}
