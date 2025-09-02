import { LRUCache } from 'lru-cache';
import { createHash } from 'crypto';

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  max?: number; // Maximum number of items in cache
  updateAgeOnGet?: boolean;
  stale?: boolean; // Allow stale cache on error
}

// In-memory cache with LRU eviction
class MemoryCache {
  private cache: LRUCache<string, any>;

  constructor(options: CacheOptions = {}) {
    this.cache = new LRUCache({
      max: options.max || 500,
      ttl: options.ttl || 5 * 60 * 1000, // 5 minutes default
      updateAgeOnGet: options.updateAgeOnGet ?? true,
      allowStale: options.stale ?? true,
    });
  }

  async get<T>(key: string): Promise<T | null> {
    return this.cache.get(key) || null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    this.cache.set(key, value, { ttl });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async has(key: string): Promise<boolean> {
    return this.cache.has(key);
  }

  getStats() {
    return {
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize,
    };
  }
}

// Redis-compatible cache interface (for future implementation)
export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
}

// Cache key builder
export class CacheKeyBuilder {
  private parts: string[] = [];

  constructor(private namespace: string) {}

  add(part: string | number | boolean): this {
    this.parts.push(String(part));
    return this;
  }

  addHash(data: any): this {
    const hash = createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex')
      .substring(0, 8);
    this.parts.push(hash);
    return this;
  }

  build(): string {
    return `${this.namespace}:${this.parts.join(':')}`;
  }
}

// Cache decorator for methods
export function Cacheable(options: CacheOptions & { key?: string } = {}) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    const cache = new MemoryCache(options);

    descriptor.value = async function (...args: any[]) {
      // Build cache key
      const keyBuilder = new CacheKeyBuilder(options.key || propertyKey);
      keyBuilder.addHash(args);
      const cacheKey = keyBuilder.build();

      // Try to get from cache
      const cached = await cache.get(cacheKey);
      if (cached !== null) {
        return cached;
      }

      // Execute original method
      try {
        const result = await originalMethod.apply(this, args);
        await cache.set(cacheKey, result);
        return result;
      } catch (error) {
        // Return stale cache on error if available
        if (options.stale) {
          const stale = await cache.get(cacheKey);
          if (stale !== null) {
            console.warn(`Returning stale cache for ${cacheKey} due to error:`, error);
            return stale;
          }
        }
        throw error;
      }
    };

    return descriptor;
  };
}

// Cache-aside pattern helper
export class CacheAside {
  constructor(
    private cache: CacheProvider,
    private options: CacheOptions = {}
  ) {}

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    // Try cache first
    const cached = await this.cache.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - execute factory
    const value = await factory();
    
    // Store in cache
    await this.cache.set(key, value, ttl || this.options.ttl);
    
    return value;
  }

  async invalidate(key: string): Promise<void> {
    await this.cache.delete(key);
  }

  async invalidatePattern(pattern: string): Promise<void> {
    // For now, we can't do pattern matching with memory cache
    // This would be implemented with Redis SCAN command
    console.warn('Pattern invalidation not supported with memory cache');
  }
}

// Request-level cache for deduplication
export class RequestCache {
  private cache = new Map<string, Promise<any>>();

  async dedupe<T>(
    key: string,
    factory: () => Promise<T>
  ): Promise<T> {
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const promise = factory();
    this.cache.set(key, promise);

    try {
      const result = await promise;
      return result;
    } catch (error) {
      // Remove from cache on error
      this.cache.delete(key);
      throw error;
    }
  }

  clear() {
    this.cache.clear();
  }
}

// Edge caching headers
export function setCacheHeaders(
  response: Response,
  options: {
    maxAge?: number; // Browser cache in seconds
    sMaxAge?: number; // CDN cache in seconds
    staleWhileRevalidate?: number;
    public?: boolean;
    immutable?: boolean;
  }
): Response {
  const parts: string[] = [];

  if (options.public) {
    parts.push('public');
  } else {
    parts.push('private');
  }

  if (options.maxAge !== undefined) {
    parts.push(`max-age=${options.maxAge}`);
  }

  if (options.sMaxAge !== undefined) {
    parts.push(`s-maxage=${options.sMaxAge}`);
  }

  if (options.staleWhileRevalidate !== undefined) {
    parts.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
  }

  if (options.immutable) {
    parts.push('immutable');
  }

  response.headers.set('Cache-Control', parts.join(', '));
  return response;
}

// Global cache instances
export const memoryCache = new MemoryCache();
export const apiCache = new CacheAside(memoryCache, { ttl: 60 * 1000 }); // 1 minute
export const userCache = new CacheAside(memoryCache, { ttl: 5 * 60 * 1000 }); // 5 minutes

// Cache warming
export async function warmCache() {
  // Implement cache warming logic for critical data
  console.log('Cache warming not implemented yet');
}
