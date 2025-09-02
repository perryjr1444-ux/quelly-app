import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ApiResponse } from '@/types/api';
import { rateLimit } from '@/lib/ratelimit';
import { cache } from '@/lib/cache/redis';
import { createPasswordSchema } from '@/lib/validation/schemas';
import { z } from 'zod';

// This route now manages pointer references only and delegates secret creation to a Supabase Edge Function (vault-store)

// GET /api/passwords → list user’s passwords
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { searchParams } = new URL(req.url);
  const label = searchParams.get('label');
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

  const cacheKey = `password_refs:list:${user.id}:${label || 'all'}`;
  const data = await cache.getOrSet<any[]>(
    cacheKey,
    async () => {
      let query = supabase
        .from('password_references')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (label) {
        query = query.eq('label', label);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    { ttl: 30, tags: [
      `password_refs:${user.id}`,
      label ? `password_refs:${user.id}:label:${label}` : ''
    ].filter(Boolean) as string[] }
  );

  return NextResponse.json<ApiResponse<any[]>>({ ok: true, data });
}

// POST /api/passwords → generate + insert a new one
export async function POST(req: NextRequest) {
  if (!rateLimit(req, 'passwords-create', 30, 60_000)) {
    return NextResponse.json<ApiResponse<null>>(
      { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
      { status: 429 }
    );
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

  // Quotas: free vs pro based on entitlements
  let isPro = false;
  const { data: org } = await supabase.from('orgs').select('id').eq('owner_id', user.id).maybeSingle();
  if (org?.id) {
    const { data: ent } = await supabase.from('entitlements').select('plan').eq('org_id', org.id).maybeSingle();
    isPro = ent?.plan === 'pro';
  }
  if (!isPro) {
    const { count } = await supabase
      .from('password_references')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'active');
    if ((count || 0) >= 10) {
      return NextResponse.json<ApiResponse<null>>(
        { ok: false, error: { code: 'QUOTA_EXCEEDED', message: 'Free plan limit reached' } },
        { status: 402 }
      );
    }
  }

  // Validate request body
  let label: string | undefined = undefined;
  let expiresAt: string | undefined = undefined;
  let metadata: Record<string, any> | undefined = undefined;
  
  try {
    const body = await req.json();
    const validatedData = createPasswordSchema.parse(body);
    label = validatedData.label;
    expiresAt = validatedData.expiresAt;
    metadata = validatedData.metadata;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiResponse<null>>(
        { 
          ok: false, 
          error: { 
            code: 'VALIDATION_ERROR', 
            message: 'Invalid request data',
            details: error.errors
          } 
        },
        { status: 400 }
      );
    }
  }

  // Delegate to edge function to create/rotate secret and store blinded pointer
  const edgeUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/vault-store`;
  const res = await fetch(edgeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'X-Internal-Auth': process.env.INTERNAL_FUNCTION_SECRET || '',
    },
    body: JSON.stringify({ user_id: user.id, label, expires_at: expiresAt, metadata }),
  });
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'EDGE_ERROR', message: text || 'vault-store failed' } }, { status: 500 });
  }
  const { data, ok } = await res.json();
  if (!ok) {
    return NextResponse.json<ApiResponse<null>>({ ok: false, error: { code: 'EDGE_ERROR', message: 'vault-store error' } }, { status: 500 });
  }

  // Best-effort log event; ignore error
  if (data?.id) {
    try {
      await supabase.from('password_events').insert([{ password_id: data.id, event: 'created' }]);
      await cache.invalidateByTags([`password_refs:${user.id}`, label ? `password_refs:${user.id}:label:${label}` : '']);
    } catch {}
  }
  return NextResponse.json<ApiResponse<any>>({ ok: true, data: data });
}
