import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { ApiResponse } from '@/types/api';

export type ValidatedRequest<T = any> = NextRequest & {
  validatedData?: T;
};

export function withValidation<T>(
  schema: z.ZodType<T>,
  handler: (req: ValidatedRequest<T>) => Promise<NextResponse>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      // Parse request body
      const body = await req.json().catch(() => ({}));
      
      // Validate against schema
      const validatedData = schema.parse(body);
      
      // Add validated data to request
      const validatedReq = req as ValidatedRequest<T>;
      validatedReq.validatedData = validatedData;
      
      // Call the handler with validated data
      return handler(validatedReq);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        
        return NextResponse.json<ApiResponse<null>>(
          {
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request data',
              details: { errors },
            },
          },
          { status: 400 }
        );
      }
      
      // Handle other errors
      return NextResponse.json<ApiResponse<null>>(
        {
          ok: false,
          error: {
            code: 'SERVER_ERROR',
            message: 'An unexpected error occurred',
          },
        },
        { status: 500 }
      );
    }
  };
}

export function withQueryValidation<T>(
  schema: z.ZodType<T>,
  handler: (req: ValidatedRequest<T>) => Promise<NextResponse>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      // Parse query parameters
      const { searchParams } = new URL(req.url);
      const query = Object.fromEntries(searchParams.entries());
      
      // Validate against schema
      const validatedData = schema.parse(query);
      
      // Add validated data to request
      const validatedReq = req as ValidatedRequest<T>;
      validatedReq.validatedData = validatedData;
      
      // Call the handler with validated data
      return handler(validatedReq);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        
        return NextResponse.json<ApiResponse<null>>(
          {
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid query parameters',
              details: { errors },
            },
          },
          { status: 400 }
        );
      }
      
      // Handle other errors
      return NextResponse.json<ApiResponse<null>>(
        {
          ok: false,
          error: {
            code: 'SERVER_ERROR',
            message: 'An unexpected error occurred',
          },
        },
        { status: 500 }
      );
    }
  };
}

// Combined validation for both body and query
export function withFullValidation<B, Q>(
  bodySchema: z.ZodType<B>,
  querySchema: z.ZodType<Q>,
  handler: (req: ValidatedRequest<{ body: B; query: Q }>) => Promise<NextResponse>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      // Parse request body
      const body = await req.json().catch(() => ({}));
      const validatedBody = bodySchema.parse(body);
      
      // Parse query parameters
      const { searchParams } = new URL(req.url);
      const query = Object.fromEntries(searchParams.entries());
      const validatedQuery = querySchema.parse(query);
      
      // Add validated data to request
      const validatedReq = req as ValidatedRequest<{ body: B; query: Q }>;
      validatedReq.validatedData = {
        body: validatedBody,
        query: validatedQuery,
      };
      
      // Call the handler with validated data
      return handler(validatedReq);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errors = error.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        }));
        
        return NextResponse.json<ApiResponse<null>>(
          {
            ok: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request data',
              details: { errors },
            },
          },
          { status: 400 }
        );
      }
      
      // Handle other errors
      return NextResponse.json<ApiResponse<null>>(
        {
          ok: false,
          error: {
            code: 'SERVER_ERROR',
            message: 'An unexpected error occurred',
          },
        },
        { status: 500 }
      );
    }
  };
}
