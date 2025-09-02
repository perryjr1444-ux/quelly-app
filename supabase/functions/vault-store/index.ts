// Deno Deploy / Supabase Edge Function: vault-store
// Creates/rotates a secret in vault.secrets and upserts public.password_references with a blinded pointer.

// Notes:
// - Expects env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAULT_POINTER_PEPPER, VAULT_KEK (base64)
// - Request JSON: { user_id: string, label?: string }
// - Response JSON: { ok: boolean, data?: { id: string, user_id: string, label?: string|null, pointer: string, current_version: number, status: string, created_at: string }, error?: { code: string, message: string } }

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

function toBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function randomStringUrl(len: number): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(len));
  return toBase64Url(raw).slice(0, len);
}

async function aesGcmEncrypt(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

async function aesGcmDecrypt(key: CryptoKey, payload: Uint8Array): Promise<Uint8Array> {
  const iv = payload.slice(0, 12);
  const ct = payload.slice(12);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  return pt;
}

async function importAesKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function exportRawKey(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

function jsonResponse<T>(status: number, body: ApiResponse<T>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function bytesToHex(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16).padStart(2, '0');
    hex.push(h);
  }
  return hex.join('');
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
    const PEPPER_B64 = Deno.env.get('VAULT_POINTER_PEPPER')!;
    const KEK_B64 = Deno.env.get('VAULT_KEK')!;
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PEPPER_B64 || !KEK_B64) {
      return jsonResponse(500, { ok: false, error: { code: 'MISSING_ENV', message: 'Missing required env vars' } });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const { user_id, label } = await req.json().catch(() => ({}));
    if (!user_id || typeof user_id !== 'string') {
      return jsonResponse(400, { ok: false, error: { code: 'BAD_REQUEST', message: 'user_id required' } });
    }

    // Derive blinded pointer from HMAC(pepper, user_id:label)
    const pepperBytes = base64ToBytes(PEPPER_B64);
    const pointerBytes = await hmacSha256(pepperBytes, `${user_id}:${label ?? ''}`);
    const pointer = toBase64Url(pointerBytes);

    // Version = 1 + max(version) in vault.secrets for pointer
    const { data: maxVerRows } = await supabase
      .schema('vault')
      .from('secrets')
      .select('version')
      .eq('pointer', pointer)
      .order('version', { ascending: false })
      .limit(1);
    const nextVersion = (maxVerRows && maxVerRows.length > 0) ? (maxVerRows[0].version + 1) : 1;

    // Generate new secret and DEK, encrypt secret, wrap DEK with KEK
    const secret = await randomStringUrl(32);
    const dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const secretBytes = new TextEncoder().encode(secret);
    const ciphertext = await aesGcmEncrypt(dek, secretBytes);

    const kekRaw = base64ToBytes(KEK_B64);
    const kek = await importAesKeyRaw(kekRaw);
    const dekRaw = await exportRawKey(dek);
    const dekWrapped = await aesGcmEncrypt(kek, dekRaw);

    // Store in vault.secrets (ciphertext and wrapped DEK as bytea via base64)
    const { error: insErr } = await supabase
      .schema('vault')
      .from('secrets')
      .insert([
        {
          pointer,
          version: nextVersion,
          // PostgREST expects bytea as hex string prefixed with "\\x"
          ciphertext: `\\x${bytesToHex(ciphertext)}` as unknown as Uint8Array,
          dek_wrapped: `\\x${bytesToHex(dekWrapped)}` as unknown as Uint8Array,
        } as any,
      ]);
    if (insErr) {
      return jsonResponse(500, { ok: false, error: { code: 'DB_ERROR', message: `vault insert failed: ${insErr.message}` } });
    }

    // Upsert pointer reference (no secret)
    const { data: refRow, error: refErr } = await supabase
      .from('password_references')
      .upsert({ user_id, label: label ?? null, pointer, current_version: nextVersion, status: 'active' }, { onConflict: 'pointer' })
      .select()
      .single();
    if (refErr) {
      return jsonResponse(500, { ok: false, error: { code: 'DB_ERROR', message: `reference upsert failed: ${refErr.message}` } });
    }

    return jsonResponse(200, { ok: true, data: refRow });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: { code: 'INTERNAL', message: String(err?.message || err) } });
  }
}

// Standard Supabase Edge Function export
serve(handler);


