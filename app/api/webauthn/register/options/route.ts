import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WebAuthnService } from '@/lib/auth/webauthn';
import { withErrorHandling, AuthenticationError } from '@/lib/errors/handler';

export const POST = withErrorHandling(async (req: NextRequest) => {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AuthenticationError();

  const body = await req.json().catch(() => ({}));
  const userName = body.userName || user.email || user.id;
  const userDisplayName = body.userDisplayName || user.email || 'User';

  const options = await WebAuthnService.generateRegistrationOptions({
    userId: user.id,
    userName,
    userDisplayName,
    requireUserVerification: true,
    preferPlatformAuthenticator: true,
  } as any);

  return NextResponse.json({ ok: true, data: options });
}, { action: 'webauthn_register_options', resourceType: 'auth' });
