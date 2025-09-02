import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { WebAuthnService } from '@/lib/auth/webauthn';
import { withErrorHandling, AuthenticationError } from '@/lib/errors/handler';

export const POST = withErrorHandling(async (req: NextRequest) => {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new AuthenticationError();

  const options = await WebAuthnService.generateAuthenticationOptions({ userId: user.id });
  return NextResponse.json({ ok: true, data: options });
}, { action: 'webauthn_auth_options', resourceType: 'auth' });
