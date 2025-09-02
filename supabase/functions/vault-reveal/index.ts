// Deno Deploy / Supabase Edge Function: vault-reveal
// Claims OTAC (optional) and decrypts the latest version for a pointer

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

type ApiResponse<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function importAesKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function aesGcmDecrypt(key: CryptoKey, payload: Uint8Array): Promise<Uint8Array> {
  const iv = payload.slice(0, 12);
  const ct = payload.slice(12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  return pt;
}

function jsonResponse<T>(status: number, body: ApiResponse<T>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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
    const KEK_B64 = Deno.env.get('VAULT_KEK')!;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !KEK_B64) {
      return jsonResponse(500, { ok: false, error: { code: 'MISSING_ENV', message: 'Missing required env vars' } });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const { pointer, version, user_id } = await req.json().catch(() => ({}));
    if (!pointer || typeof pointer !== 'string') {
      return jsonResponse(400, { ok: false, error: { code: 'BAD_REQUEST', message: 'pointer required' } });
    }
    if (!user_id || typeof user_id !== 'string') {
      return jsonResponse(400, { ok: false, error: { code: 'BAD_REQUEST', message: 'user_id required' } });
    }

    // Verify that the pointer belongs to the requesting user
    const { data: refRow, error: refErr } = await supabase
      .from('password_references')
      .select('user_id, pointer')
      .eq('pointer', pointer)
      .limit(1);
    if (refErr) {
      return jsonResponse(500, { ok: false, error: { code: 'DB_ERROR', message: refErr.message } });
    }
    if (!refRow || refRow.length === 0 || refRow[0].user_id !== user_id) {
      return jsonResponse(403, { ok: false, error: { code: 'FORBIDDEN', message: 'Pointer not owned by user' } });
    }

    // Get latest version if not provided
    let targetVersion = version;
    if (!targetVersion) {
      const { data: maxVerRows } = await supabase
        .from('vault.secrets')
        .select('version')
        .eq('pointer', pointer)
        .order('version', { ascending: false })
        .limit(1);
      targetVersion = (maxVerRows && maxVerRows.length > 0) ? maxVerRows[0].version : null;
    }
    if (!targetVersion) {
      return jsonResponse(404, { ok: false, error: { code: 'NOT_FOUND', message: 'No secret version found' } });
    }

    const { data: rows, error: selErr } = await supabase
      .schema('vault')
      .from('secrets')
      .select('ciphertext, dek_wrapped')
      .eq('pointer', pointer)
      .eq('version', targetVersion)
      .limit(1);
    if (selErr) {
      return jsonResponse(500, { ok: false, error: { code: 'DB_ERROR', message: selErr.message } });
    }
    if (!rows || rows.length === 0) {
      return jsonResponse(404, { ok: false, error: { code: 'NOT_FOUND', message: 'Secret not found' } });
    }

    const kek = await importAesKeyRaw(base64ToBytes(KEK_B64));
    const dekRaw = await aesGcmDecrypt(kek, rows[0].dek_wrapped as unknown as Uint8Array);
    const dek = await importAesKeyRaw(dekRaw);
    const pt = await aesGcmDecrypt(dek, rows[0].ciphertext as unknown as Uint8Array);
    const secret = new TextDecoder().decode(pt);

    // Return plaintext for now; TODO: upgrade to sealed envelope/E2E
    // Ensure response is non-cacheable
    const resp = jsonResponse(200, { ok: true, data: { pointer, version: targetVersion, secret } });
    resp.headers.set('Cache-Control', 'no-store');
    return resp;
  } catch (err) {
    return jsonResponse(500, { ok: false, error: { code: 'INTERNAL', message: String(err?.message || err) } });
  }
}

serve(handler);


