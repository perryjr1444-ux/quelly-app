import { createClient } from '@/lib/supabase/server';
import { createHash } from 'crypto';

type Bucket = { 
  timestamps: number[];
  violations: number;
  blacklistedUntil?: number;
};

const store = new Map<string, Bucket>();
const blacklist = new Set<string>();

// Cleanup old entries every minute
if (typeof window === 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of store.entries()) {
      // Remove old timestamps
      bucket.timestamps = bucket.timestamps.filter(ts => now - ts < 3600000); // Keep 1 hour
      
      // Remove blacklist if expired
      if (bucket.blacklistedUntil && now > bucket.blacklistedUntil) {
        bucket.blacklistedUntil = undefined;
        blacklist.delete(key);
      }
      
      // Delete empty buckets
      if (bucket.timestamps.length === 0 && !bucket.blacklistedUntil) {
        store.delete(key);
      }
    }
  }, 60000);
}

function getClientKey(req: Request): string {
  // Multiple header checks for better proxy support
  const headers = [
    'cf-connecting-ip', // Cloudflare
    'x-forwarded-for',
    'x-real-ip',
    'x-client-ip',
  ];
  
  for (const header of headers) {
    const value = req.headers.get(header);
    if (value) {
      // Handle x-forwarded-for which can have multiple IPs
      if (header === 'x-forwarded-for') {
        const ips = value.split(',').map(ip => ip.trim());
        if (ips[0]) return ips[0];
      }
      return value;
    }
  }
  
  // Fallback to user agent hash for additional uniqueness
  const ua = req.headers.get('user-agent') || 'unknown';
  const hash = createHash('sha256').update(ua).digest('hex').substring(0, 8);
  return `unknown-${hash}`;
}

export function rateLimit(
  req: Request, 
  id: string, 
  limit: number, 
  windowMs: number,
  options?: {
    blacklistThreshold?: number; // Number of violations before blacklisting
    blacklistDurationMs?: number; // How long to blacklist
    onViolation?: (key: string, violations: number) => void;
  }
): boolean {
  const now = Date.now();
  const clientKey = getClientKey(req);
  const key = `${id}:${clientKey}`;
  
  // Check if client is blacklisted
  if (blacklist.has(key)) {
    const bucket = store.get(key);
    if (bucket?.blacklistedUntil && now < bucket.blacklistedUntil) {
      return false;
    }
    // Remove from blacklist if expired
    blacklist.delete(key);
  }
  
  const bucket = store.get(key) || { timestamps: [], violations: 0 };
  
  // Prune old timestamps
  bucket.timestamps = bucket.timestamps.filter(ts => now - ts < windowMs);
  
  // Check if limit exceeded
  if (bucket.timestamps.length >= limit) {
    bucket.violations++;
    
    // Check for blacklisting
    const threshold = options?.blacklistThreshold || limit * 3;
    if (bucket.violations >= threshold) {
      const duration = options?.blacklistDurationMs || windowMs * 10;
      bucket.blacklistedUntil = now + duration;
      blacklist.add(key);
      
      // Log security event
      logRateLimitViolation(clientKey, id, bucket.violations);
    }
    
    // Call violation handler if provided
    if (options?.onViolation) {
      options.onViolation(key, bucket.violations);
    }
    
    store.set(key, bucket);
    return false;
  }
  
  // Add new timestamp
  bucket.timestamps.push(now);
  store.set(key, bucket);
  return true;
}

// User-based rate limiting with plan support
export async function userRateLimit(
  req: Request,
  userId: string | null,
  id: string,
  baseLimit: number,
  windowMs: number
): Promise<boolean> {
  if (!userId) {
    // Stricter limits for unauthenticated users
    return rateLimit(req, `anon:${id}`, Math.floor(baseLimit / 2), windowMs);
  }
  
  // Get user's plan for custom limits
  let limit = baseLimit;
  try {
    const supabase = createClient();
    const { data: org } = await supabase
      .from('orgs')
      .select('id')
      .eq('owner_id', userId)
      .maybeSingle();
      
    if (org?.id) {
      const { data: entitlement } = await supabase
        .from('entitlements')
        .select('plan')
        .eq('org_id', org.id)
        .maybeSingle();
        
      // Adjust limits based on plan
      switch (entitlement?.plan) {
        case 'pro':
          limit = baseLimit * 2;
          break;
        case 'enterprise':
          limit = baseLimit * 10;
          break;
      }
    }
  } catch (error) {
    console.error('Failed to fetch user plan:', error);
  }
  
  // Use user ID for rate limiting
  const key = `user:${userId}:${id}`;
  const now = Date.now();
  const bucket = store.get(key) || { timestamps: [], violations: 0 };
  
  bucket.timestamps = bucket.timestamps.filter(ts => now - ts < windowMs);
  
  if (bucket.timestamps.length >= limit) {
    bucket.violations++;
    store.set(key, bucket);
    
    // Log user rate limit violation
    if (bucket.violations > 3) {
      logRateLimitViolation(userId, id, bucket.violations, true);
    }
    
    return false;
  }
  
  bucket.timestamps.push(now);
  store.set(key, bucket);
  return true;
}

// Sliding window rate limiter
export class SlidingWindowRateLimiter {
  private windows = new Map<string, number[]>();
  
  limit(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const timestamps = this.windows.get(key) || [];
    
    // Remove old timestamps outside the window
    const validTimestamps = timestamps.filter(ts => now - ts < windowMs);
    
    if (validTimestamps.length >= max) {
      this.windows.set(key, validTimestamps);
      return false;
    }
    
    validTimestamps.push(now);
    this.windows.set(key, validTimestamps);
    return true;
  }
  
  reset(key: string) {
    this.windows.delete(key);
  }
}

// Helper to log rate limit violations
async function logRateLimitViolation(
  identifier: string, 
  endpoint: string, 
  violations: number,
  isUser: boolean = false
) {
  try {
    const supabase = createClient();
    await supabase.from('security_events').insert({
      event_type: 'rate_limit_violation',
      identifier,
      endpoint,
      violations,
      is_user: isUser,
      created_at: new Date().toISOString()
    });
  } catch (error) {
    // Fail silently - don't let logging errors affect the app
    console.error('Failed to log rate limit violation:', error);
  }
}

// Export a global rate limiter instance
export const globalRateLimiter = new SlidingWindowRateLimiter();