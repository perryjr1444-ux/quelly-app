import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { twoFactorAuth } from '@/lib/auth/two-factor';
import { withValidation } from '@/lib/validation/middleware';
import { withErrorHandling } from '@/lib/errors/handler';
import { AuthenticationError, ValidationError } from '@/lib/errors/handler';
import { verify2FASchema } from '@/lib/validation/schemas';
import type { ApiResponse } from '@/types/api';

export const POST = withErrorHandling(
  withValidation(verify2FASchema, async (req) => {
    const supabase = createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      throw new AuthenticationError();
    }
    
    const { code } = req.validatedData!;
    
    // Verify code and enable 2FA
    const success = await twoFactorAuth.verifyAndEnable(user.id, code);
    
    if (!success) {
      throw new ValidationError('Invalid verification code');
    }
    
    return NextResponse.json<ApiResponse<{ enabled: boolean }>>({
      ok: true,
      data: { enabled: true },
    });
  }),
  { action: '2fa_enable', resourceType: 'auth' }
);
