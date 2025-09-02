import { NextResponse } from 'next/server';
import type { ApiResponse } from '@/types/api';
import { auditLogger } from '@/lib/audit/logger';
import * as Sentry from '@sentry/nextjs';

// Custom error classes
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super('NOT_AUTHENTICATED', message, 401);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super('FORBIDDEN', message, 403);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super('RATE_LIMITED', 'Too many requests', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}

export class QuotaExceededError extends AppError {
  constructor(resource: string, limit: number) {
    super('QUOTA_EXCEEDED', `${resource} quota exceeded. Limit: ${limit}`, 402, { resource, limit });
    this.name = 'QuotaExceededError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super('EXTERNAL_SERVICE_ERROR', `${service} error: ${message}`, 502, { service });
    this.name = 'ExternalServiceError';
  }
}

// Error handler
export async function handleError(
  error: unknown,
  context?: {
    action?: string;
    resourceType?: string;
    userId?: string;
    metadata?: Record<string, any>;
  }
): Promise<NextResponse> {
  // Log to audit system
  if (context) {
    await auditLogger.logError(
      context.action || 'unknown',
      context.resourceType || 'unknown',
      error as Error,
      context
    );
  }

  // Handle known errors
  if (error instanceof AppError) {
    // Log to Sentry for server errors
    if (error.statusCode >= 500) {
      Sentry.captureException(error, {
        tags: {
          error_code: error.code,
          action: context?.action,
          resource_type: context?.resourceType,
        },
        extra: {
          details: error.details,
          userId: context?.userId,
          metadata: context?.metadata,
        },
      });
    }

    return NextResponse.json<ApiResponse<null>>(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { 
        status: error.statusCode,
        headers: error instanceof RateLimitError && error.details?.retryAfter
          ? { 'Retry-After': error.details.retryAfter.toString() }
          : undefined,
      }
    );
  }

  // Handle Supabase errors
  if (error && typeof error === 'object' && 'code' in error) {
    const supabaseError = error as any;
    const statusCode = getSupabaseErrorStatus(supabaseError.code);
    
    return NextResponse.json<ApiResponse<null>>(
      {
        ok: false,
        error: {
          code: supabaseError.code || 'DB_ERROR',
          message: supabaseError.message || 'Database error',
        },
      },
      { status: statusCode }
    );
  }

  // Handle unknown errors
  const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
  const errorStack = error instanceof Error ? error.stack : undefined;

  // Log to Sentry
  Sentry.captureException(error, {
    tags: {
      action: context?.action,
      resource_type: context?.resourceType,
    },
    extra: {
      userId: context?.userId,
      metadata: context?.metadata,
      errorMessage,
      errorStack,
    },
  });

  // Don't expose internal errors in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'An unexpected error occurred' 
    : errorMessage;

  return NextResponse.json<ApiResponse<null>>(
    {
      ok: false,
      error: {
        code: 'SERVER_ERROR',
        message,
      },
    },
    { status: 500 }
  );
}

// Error boundary wrapper for API routes
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  handler: T,
  context?: {
    action: string;
    resourceType: string;
  }
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await handler(...args);
    } catch (error) {
      const req = args[0];
      const userId = req?.userId || req?.user?.id;
      
      return handleError(error, {
        ...context,
        userId,
        metadata: {
          url: req?.url,
          method: req?.method,
        },
      });
    }
  }) as T;
}

// Helper to get appropriate status code for Supabase errors
function getSupabaseErrorStatus(code: string): number {
  const statusMap: Record<string, number> = {
    '23505': 409, // unique_violation
    '23503': 400, // foreign_key_violation
    '23502': 400, // not_null_violation
    '22P02': 400, // invalid_text_representation
    '42P01': 500, // undefined_table
    '42703': 500, // undefined_column
    'PGRST301': 404, // not found
    'PGRST204': 400, // no rows updated
    'JWT_ERROR': 401, // JWT validation error
  };

  return statusMap[code] || 500;
}

// Retry logic for transient errors
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delay?: number;
    backoff?: number;
    shouldRetry?: (error: any) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    delay = 1000,
    backoff = 2,
    shouldRetry = (error) => {
      // Retry on network errors and 5xx status codes
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
      if (error.statusCode && error.statusCode >= 500) return true;
      return false;
    },
  } = options;

  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (i === maxRetries - 1 || !shouldRetry(error)) {
        throw error;
      }
      
      const waitTime = delay * Math.pow(backoff, i);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  throw lastError;
}

// Circuit breaker for external services
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly threshold = 5,
    private readonly timeout = 60000, // 1 minute
    private readonly resetTimeout = 30000 // 30 seconds
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new ExternalServiceError('Circuit breaker', 'Service temporarily unavailable');
      }
    }

    try {
      const result = await fn();
      
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }
      
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      if (this.failures >= this.threshold) {
        this.state = 'open';
      }
      
      throw error;
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }
}
