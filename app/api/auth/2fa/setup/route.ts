import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { twoFactorAuth } from '@/lib/auth/two-factor';
import { withErrorHandling } from '@/lib/errors/handler';
import { AuthenticationError } from '@/lib/errors/handler';
import type { ApiResponse } from '@/types/api';
import QRCode from 'qrcode';

export const POST = withErrorHandling(
  async (req: NextRequest) => {
    const supabase = createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      throw new AuthenticationError();
    }
    
    // Check if 2FA is already enabled
    const isEnabled = await twoFactorAuth.isEnabled(user.id);
    if (isEnabled) {
      return NextResponse.json<ApiResponse<null>>({
        ok: false,
        error: {
          code: 'ALREADY_ENABLED',
          message: '2FA is already enabled for this account',
        },
      }, { status: 400 });
    }
    
    // Generate new secret
    const { secret, qrCode: otpauthUrl, backupCodes } = await twoFactorAuth.generateSecret(user.id);
    
    // Generate QR code data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 256,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });
    
    return NextResponse.json<ApiResponse<{
      secret: string;
      qrCode: string;
      backupCodes: string[];
    }>>({
      ok: true,
      data: {
        secret,
        qrCode: qrCodeDataUrl,
        backupCodes,
      },
    });
  },
  { action: '2fa_setup', resourceType: 'auth' }
);
