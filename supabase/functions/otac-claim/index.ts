// Claims a one-time authorization code for a session. Idempotent.

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

    const { session_id, code } = await req.json().catch(() => ({}));
    if (!session_id || !code) {
      return jsonResponse(400, { ok: false, error: { code: 'BAD_REQUEST', message: 'session_id and code required' } });
    }
    const pepper = Uint8Array.from(atob(OTAC_PEPPER_B64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', pepper, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
    const codeHash = toBase64Url(new Uint8Array(sig));

    const { data: sess, error } = await supabase
      .from('otac_sessions')
      .select('id, code_hash, claimed_at, expires_at, user_id, scope')
      .eq('id', session_id)
      .single();
    if (error) return jsonResponse(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });

    if (sess.claimed_at) {
      return jsonResponse(200, { ok: true, data: { claimed: true } });
    }
    if (new Date(sess.expires_at).getTime() < Date.now()) {
      return jsonResponse(410, { ok: false, error: { code: 'EXPIRED', message: 'Session expired' } });
    }
    if (sess.code_hash !== codeHash) {
      return jsonResponse(401, { ok: false, error: { code: 'INVALID_CODE', message: 'Invalid code' } });
    }

    const { error: updErr } = await supabase
      .from('otac_sessions')
      .update({ claimed_at: new Date().toISOString() })
      .eq('id', session_id)
      .is('claimed_at', null);
    if (updErr) {
      return jsonResponse(409, { ok: false, error: { code: 'RACE', message: 'Already claimed' } });
    }

    return jsonResponse(200, { ok: true, data: { claimed: true, user_id: sess.user_id, scope: sess.scope } });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: { code: 'INTERNAL', message: String(err?.message || err) } });
  }
}

serve(handler);


