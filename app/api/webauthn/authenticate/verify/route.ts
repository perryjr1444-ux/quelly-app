import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WebAuthnService } from '@/lib/auth/webauthn';
import { withErrorHandling, AuthenticationError, ValidationError } from '@/lib/errors/handler';

export const POST = withErrorHandling(async (req: NextRequest) => {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AuthenticationError();

  const { credentialId, clientDataJSON, authenticatorData, signature } = await req.json();
  if (!credentialId || !clientDataJSON || !authenticatorData || !signature) {
    throw new ValidationError('Missing authentication payload');
  }

  const result = await WebAuthnService.verifyAuthentication(
    user.id,
    credentialId,
    clientDataJSON,
    authenticatorData,
    signature
  );

  return NextResponse.json({ ok: result.verified, data: result });
}, { action: 'webauthn_auth_verify', resourceType: 'auth' });
