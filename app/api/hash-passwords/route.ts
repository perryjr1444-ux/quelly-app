import { NextRequest, NextResponse } from 'next/server';
import { HashBasedPasswordService } from '@/lib/crypto/hash-based-passwords';
import { withErrorHandling } from '@/lib/errors/handler';
import { withValidation } from '@/lib/validation/middleware';
import { z } from 'zod';
import type { ApiResponse } from '@/types/api';

const generateHashPasswordSchema = z.object({
  service: z.string().min(1),
  algorithm: z.enum(['sha256', 'sha512', 'blake2b']).optional(),
  iterations: z.number().min(1000).max(100000).optional(),
  customSecret: z.string().optional(),
});

const rotateHashPasswordSchema = z.object({
  passwordId: z.string().uuid(),
  reason: z.string().optional(),
});

const verifyHashPasswordSchema = z.object({
  passwordId: z.string().uuid(),
  password: z.string().min(1),
});

/**
 * Hash-Based Password API Endpoints
 * 
 * THE CORE REVOLUTIONARY FEATURE:
 * - Generate hash-based passwords that are cryptographically secure
 * - Automatic rotation changes timestamp/nonce, making old hashes invalid
 * - Integration with handshake.py protocol for additional security
 */

/**
 * Generate a new hash-based password
 */
export const POST = withErrorHandling(
  withValidation(generateHashPasswordSchema, async (req) => {
    const { service, algorithm, iterations, customSecret } = req.validatedData!;
    
    // Get user ID from session (you'll need to implement this)
    const userId = 'user-id-from-session'; // TODO: Get from auth
    
    const result = await HashBasedPasswordService.generateHashPassword(userId, service, {
      algorithm,
      iterations,
      customSecret
    });
    
    return NextResponse.json<ApiResponse<{
      passwordId: string;
      password: string;
      hash: string;
      expiresAt: string;
      algorithm: string;
      iterations: number;
    }>>({
      ok: true,
      data: {
        passwordId: result.config.baseSecret, // This would be the actual password ID
        password: result.password,
        hash: result.hash,
        expiresAt: result.expiresAt.toISOString(),
        algorithm: result.config.algorithm,
        iterations: result.config.iterations
      }
    });
  }),
  { action: 'generate_hash_password', resourceType: 'password' }
);

/**
 * Rotate a hash-based password
 */
export const PUT = withErrorHandling(
  withValidation(rotateHashPasswordSchema, async (req) => {
    const { passwordId, reason } = req.validatedData!;
    
    // Get user ID from session
    const userId = 'user-id-from-session'; // TODO: Get from auth
    
    const result = await HashBasedPasswordService.rotateHashPassword(
      passwordId,
      'service-from-password', // TODO: Get from password record
      reason || 'Manual rotation'
    );
    
    return NextResponse.json<ApiResponse<{
      oldPasswordId: string;
      newPasswordId: string;
      newPassword: string;
      newHash: string;
      reason: string;
      timestamp: string;
    }>>({
      ok: true,
      data: {
        oldPasswordId: result.config.baseSecret, // This would be the actual password ID
        newPasswordId: result.config.baseSecret, // This would be the new password ID
        newPassword: result.password,
        newHash: result.hash,
        reason: reason || 'Manual rotation',
        timestamp: result.expiresAt.toISOString()
      }
    });
  }),
  { action: 'rotate_hash_password', resourceType: 'password' }
);

/**
 * Verify a hash-based password
 */
export const PATCH = withErrorHandling(
  withValidation(verifyHashPasswordSchema, async (req) => {
    const { passwordId, password } = req.validatedData!;
    
    const result = await HashBasedPasswordService.verifyHashPassword(passwordId, password);
    
    return NextResponse.json<ApiResponse<{
      valid: boolean;
      reason?: string;
    }>>({
      ok: true,
      data: {
        valid: result.valid,
        reason: result.reason
      }
    });
  }),
  { action: 'verify_hash_password', resourceType: 'password' }
);

/**
 * Get hash-based password statistics
 */
export const GET = withErrorHandling(
  async (req: NextRequest) => {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    
    if (!userId) {
      return NextResponse.json<ApiResponse<null>>(
        { ok: false, error: { code: 'BAD_REQUEST', message: 'userId is required' } },
        { status: 400 }
      );
    }
    
    const stats = await HashBasedPasswordService.getHashPasswordStats(userId);
    
    return NextResponse.json<ApiResponse<typeof stats>>({
      ok: true,
      data: stats
    });
  },
  { action: 'get_hash_password_stats', resourceType: 'password' }
);
