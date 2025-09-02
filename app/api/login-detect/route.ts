import { NextRequest, NextResponse } from 'next/server';
import { AutoRotationService } from '@/lib/core/auto-rotation';
import { withErrorHandling } from '@/lib/errors/handler';
import { withValidation } from '@/lib/validation/middleware';
import { z } from 'zod';
import type { ApiResponse } from '@/types/api';

const loginDetectionSchema = z.object({
  passwordId: z.string().uuid(),
  service: z.string().min(1),
  success: z.boolean(),
  ipAddress: z.string().ip().optional(),
  userAgent: z.string().optional(),
});

/**
 * THE CORE REVOLUTIONARY API ENDPOINT
 * 
 * This endpoint is called when a login attempt is detected.
 * It automatically rotates the password, making it unhackable.
 * 
 * This is what makes PoofPass revolutionary - passwords become
 * single-use tokens that automatically rotate after each login.
 */
export const POST = withErrorHandling(
  withValidation(loginDetectionSchema, async (req) => {
    const { passwordId, service, success, ipAddress, userAgent } = req.validatedData!;
    
    // Get client IP if not provided
    const clientIP = ipAddress || 
      req.headers.get('x-forwarded-for')?.split(',')[0] || 
      req.headers.get('x-real-ip') || 
      'unknown';
    
    // Get user agent if not provided
    const clientUserAgent = userAgent || 
      req.headers.get('user-agent') || 
      'unknown';
    
    // THE MAGIC HAPPENS HERE: Auto-rotate password after login attempt
    const rotationResult = await AutoRotationService.handleLoginAttempt(
      passwordId,
      service,
      {
        ipAddress: clientIP,
        userAgent: clientUserAgent,
        success
      }
    );
    
    return NextResponse.json<ApiResponse<{
      rotated: boolean;
      newPasswordId?: string;
      reason: string;
      timestamp: string;
    }>>({
      ok: true,
      data: {
        rotated: rotationResult.success,
        newPasswordId: rotationResult.newPasswordId,
        reason: rotationResult.rotationReason,
        timestamp: rotationResult.timestamp.toISOString()
      }
    });
  }),
  { action: 'login_detection', resourceType: 'password' }
);

/**
 * Get rotation history for a user
 */
export const GET = withErrorHandling(
  async (req: NextRequest) => {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '50');
    
    if (!userId) {
      return NextResponse.json<ApiResponse<null>>(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'userId is required' } },
        { status: 400 }
      );
    }
    
    const rotationHistory = await AutoRotationService.getRotationHistory(userId, limit);
    
    return NextResponse.json<ApiResponse<typeof rotationHistory>>({
      ok: true,
      data: rotationHistory
    });
  },
  { action: 'view_rotation_history', resourceType: 'password' }
);
