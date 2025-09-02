// Issues a one-time authorization code session and returns a session id and QR payload

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

type ApiResponse<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

function jsonResponse<T>(status: number, body: ApiResponse<T>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST only' } });
  }

  try {
    // Optional internal auth: if INTERNAL_FUNCTION_SECRET is set, require matching header
    const INTERNAL_FUNCTION_SECRET = Deno.env.get('INTERNAL_FUNCTION_SECRET');
    if (INTERNAL_FUNCTION_SECRET) {
      const internalAuth = req.headers.get('x-internal-auth');
      if (internalAuth !== INTERNAL_FUNCTION_SECRET) {
        return jsonResponse(401, { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid internal auth' } });
      }
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const OTAC_PEPPER_B64 = Deno.env.get('OTAC_PEPPER')!;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !OTAC_PEPPER_B64) {
      return jsonResponse(500, { ok: false, error: { code: 'MISSING_ENV', message: 'Missing required env vars' } });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const { user_id, scope } = await req.json().catch(() => ({}));
    if (!user_id) {
      return jsonResponse(400, { ok: false, error: { code: 'BAD_REQUEST', message: 'user_id required' } });
    }
    const otac = crypto.getRandomValues(new Uint8Array(24));
    const code = toBase64Url(otac);
    const pepper = Uint8Array.from(atob(OTAC_PEPPER_B64), c => c.charCodeAt(0));
    const codeHash = toBase64Url(await hmacSha256(pepper, code));

    const ttlSeconds = Number(Deno.env.get('OTAC_TTL_SECONDS') || '90');
    const expiresAt = new Date(Date.now() + Math.max(15, Math.min(ttlSeconds, 300)) * 1000).toISOString();
    const { data: row, error } = await supabase
      .from('otac_sessions')
      .insert([{ user_id, code_hash: codeHash, scope: scope ?? null, expires_at: expiresAt }])
      .select()
      .single();
    if (error) {
      return jsonResponse(500, { ok: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return jsonResponse(200, { ok: true, data: { session_id: row.id, code } });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: { code: 'INTERNAL', message: String(err?.message || err) } });
  }
}

serve(handler);


