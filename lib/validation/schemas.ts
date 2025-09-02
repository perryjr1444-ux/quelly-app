import { z } from 'zod';

// Common schemas
export const uuidSchema = z.string().uuid('Invalid UUID format');
export const emailSchema = z.string().email('Invalid email format');
export const labelSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/, 'Label must contain only alphanumeric characters, underscores, and hyphens');

// Password-related schemas
export const createPasswordSchema = z.object({
  label: labelSchema.optional(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.string()).optional(),
});

export const updatePasswordSchema = z.object({
  status: z.enum(['active', 'used']).optional(),
  rotate: z.boolean().optional(),
});

// Check credentials schemas
export const issueCheckSchema = z.object({
  label: labelSchema.optional(),
  expires_at: z.string().datetime().optional(),
  scope: z.array(z.string()).optional(),
});

export const verifyCheckSchema = z.object({
  id: uuidSchema,
  secret: z.string().min(24).max(128),
  rotate: z.boolean().default(false),
});

export const revokeCheckSchema = z.object({
  id: uuidSchema,
  reason: z.string().optional(),
});

// Auth schemas
export const magicLinkSchema = z.object({
  email: emailSchema,
  redirectTo: z.string().url().optional(),
});

export const otacClaimSchema = z.object({
  session_id: uuidSchema,
  code: z.string().min(6).max(20),
});

export const otacStatusSchema = z.object({
  session_id: uuidSchema,
});

// Billing schemas
export const checkoutSchema = z.object({
  plan: z.enum(['pro', 'enterprise']).optional(),
  quantity: z.number().int().positive().optional(),
});

export const creditsCheckoutSchema = z.object({
  amount: z.number().int().min(10).max(1000),
  currency: z.enum(['USD', 'EUR', 'GBP']).default('USD'),
});

// Admin schemas
export const bootstrapBillingSchema = z.object({
  token: z.string().min(32),
  force: z.boolean().default(false),
});

// Event query schemas
export const passwordEventsQuerySchema = z.object({
  password_id: uuidSchema.optional(),
  event: z.enum(['created', 'used', 'rotated', 'revoked']).optional(),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
});

// Webhook schemas
export const stripeWebhookSchema = z.object({
  body: z.string(),
  signature: z.string(),
});

export const coinbaseWebhookSchema = z.object({
  event: z.object({
    type: z.string(),
    data: z.record(z.any()),
  }),
});

// Response schemas
export const apiResponseSchema = <T extends z.ZodType>(dataSchema: T) => z.object({
  ok: z.boolean(),
  data: dataSchema.optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.any()).optional(),
  }).optional(),
});

// Pagination schemas
export const paginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Security schemas
export const apiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.string().datetime().optional(),
});

// Session schemas
export const sessionSchema = z.object({
  userId: uuidSchema,
  deviceId: z.string().optional(),
  userAgent: z.string().optional(),
  ipAddress: z.string().ip().optional(),
  expiresAt: z.string().datetime(),
});

// 2FA schemas
export const enable2FASchema = z.object({
  type: z.enum(['totp', 'sms', 'email']),
  secret: z.string().optional(),
  phoneNumber: z.string().optional(),
});

export const verify2FASchema = z.object({
  code: z.string().min(6).max(6),
  type: z.enum(['totp', 'sms', 'email']),
});

// Audit log schemas
export const auditLogSchema = z.object({
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  userId: uuidSchema,
  metadata: z.record(z.any()).optional(),
  ipAddress: z.string().ip().optional(),
  userAgent: z.string().optional(),
});

// Error handling
export type ValidationError = z.ZodError<any>;

export function validateRequest<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw parsed.error;
  }
  return parsed.data;
}

export function validatePartial<T>(schema: z.ZodType<T>, data: unknown): Partial<T> {
  const partialSchema = (schema as any).partial?.() ?? z.object({});
  const parsed = partialSchema.safeParse(data);
  if (!parsed.success) {
    throw parsed.error;
  }
  return parsed.data as Partial<T>;
}
