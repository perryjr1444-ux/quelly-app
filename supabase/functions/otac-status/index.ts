// Returns whether a session has been claimed or expired

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

type ApiResponse<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

function jsonResponse<T>(status: number, body: ApiResponse<T>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return jsonResponse(405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET only' } });
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
    const url = new URL(req.url);
    const session_id = url.searchParams.get('session_id');
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return jsonResponse(500, { ok: false, error: { code: 'MISSING_ENV', message: 'Missing required env vars' } });
    }
    if (!session_id) {
      return jsonResponse(400, { ok: false, error: { code: 'BAD_REQUEST', message: 'session_id required' } });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: sess, error } = await supabase
      .from('otac_sessions')
      .select('id, claimed_at, expires_at')
      .eq('id', session_id)
      .single();
    if (error) return jsonResponse(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });

    const expired = new Date(sess.expires_at).getTime() < Date.now();
    const claimed = !!sess.claimed_at;
    return jsonResponse(200, { ok: true, data: { claimed, expired } });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: { code: 'INTERNAL', message: String(err?.message || err) } });
  }
}

serve(handler);


