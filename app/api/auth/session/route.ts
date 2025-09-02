import { NextResponse } from 'next/server';
import { SessionSecurityService } from '@/lib/security/session-security';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  // Placeholder: in a real app, map Supabase session to our secure session
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  // For demo, mint a temporary session via SessionSecurityService
  const session = await SessionSecurityService.createSecureSession(
    user.id,
    { userAgent: 'web', acceptEncoding: '', acceptLanguage: '' },
    '127.0.0.1'
  );

  return NextResponse.json({ token: session.token, sessionId: session.sessionId });
}
