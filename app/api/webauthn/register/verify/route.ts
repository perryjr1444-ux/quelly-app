import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WebAuthnService } from '@/lib/auth/webauthn';
import { withErrorHandling, AuthenticationError, ValidationError } from '@/lib/errors/handler';

export const POST = withErrorHandling(async (req: NextRequest) => {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AuthenticationError();

  const { credentialId, clientDataJSON, attestationObject } = await req.json();
  if (!clientDataJSON || !attestationObject) {
    throw new ValidationError('Missing attestation payload');
  }

  const result = await WebAuthnService.verifyRegistration(
    user.id,
    { id: credentialId } as any,
    clientDataJSON,
    attestationObject
  );

  return NextResponse.json({ ok: result.verified, data: result });
}, { action: 'webauthn_register_verify', resourceType: 'auth' });
