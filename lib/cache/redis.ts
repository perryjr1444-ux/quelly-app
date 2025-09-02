import { Redis } from 'ioredis';
import { LRUCache } from 'lru-cache';
import { PerformanceMonitor } from '@/lib/monitoring/metrics';

/**
 * Advanced Redis caching with fallback to in-memory LRU cache
 * Features:
 * - Connection pooling
 * - Automatic failover
 * - Circuit breaker pattern
 * - Cache warming
 * - Distributed cache invalidation
 * - Cache stampede prevention
 */

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  staleWhileRevalidate?: number; // Serve stale content while revalidating
  tags?: string[]; // Cache tags for invalidation
  compress?: boolean; // Compress large values
}

interface CacheEntry<T> {
  value: T;
  expires: number;
  staleUntil?: number;
  tags?: string[];
  compressed?: boolean;
}

class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  
  constructor(
    private threshold: number = 5,
    private timeout: number = 60000, // 1 minute
    private resetTimeout: number = 30000 // 30 seconds
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        return null;
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
      this.recordFailure();
      throw error;
    }
  }
  
  private recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }
}

export class RedisCache {
  private redis: Redis | null = null;
  private fallbackCache: LRUCache<string, any>;
  private circuitBreaker: CircuitBreaker;
  private locks = new Map<string, Promise<any>>();
  private subscribers = new Map<string, Set<(value: any) => void>>();
  
  constructor() {
    // Initialize fallback LRU cache
    this.fallbackCache = new LRUCache({
      max: 1000,
      ttl: 5 * 60 * 1000, // 5 minutes
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    });
    
    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker();
    
    // Initialize Redis connection
    this.initializeRedis();
  }
  
  private async initializeRedis() {
    if (!process.env.REDIS_URL) {
      console.warn('Redis URL not configured, using in-memory cache only');
      return;
    }
    
    try {
      this.redis = new Redis(process.env.REDIS_URL, {
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        reconnectOnError: (err) => {
          const targetError = 'READONLY';
          if (err.message.includes(targetError)) {
            return true;
          }
          return false;
        },
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        enableOfflineQueue: true,
      });
      
      // Set up event handlers
      this.redis.on('connect', () => {
        console.log('Redis connected');
      });
      
      this.redis.on('error', (err) => {
        console.error('Redis error:', err);
      });
      
      // Set up pub/sub for cache invalidation
      const subscriber = this.redis.duplicate();
      subscriber.on('message', (channel, message) => {
        if (channel === 'cache:invalidate') {
          const { key, tags } = JSON.parse(message);
          this.handleInvalidation(key, tags);
        }
      });
      subscriber.subscribe('cache:invalidate');
      
    } catch (error) {
      console.error('Failed to initialize Redis:', error);
      this.redis = null;
    }
  }
  
  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    const start = Date.now();
    
    try {
      // Try Redis first
      if (this.redis) {
        const result = await this.circuitBreaker.execute(async () => {
          const data = await this.redis!.get(this.prefixKey(key));
          if (!data) return null;
          
          const entry: CacheEntry<T> = JSON.parse(data);
          
          // Check if expired
          if (entry.expires < Date.now()) {
            // Check if we can serve stale
            if (entry.staleUntil && entry.staleUntil > Date.now()) {
              // Trigger background revalidation
              this.revalidateInBackground(key);
              return entry.value;
            }
            return null;
          }
          
          // Decompress if needed
          if (entry.compressed) {
            entry.value = await this.decompress(entry.value as any);
          }
          
          return entry.value;
        });
        
        if (result !== null) {
          PerformanceMonitor.gauge('cache.redis.hit_ms', Date.now() - start);
          return result;
        }
      }
      
      // Fallback to LRU cache
      const fallbackValue = this.fallbackCache.get(key);
      if (fallbackValue !== undefined) {
        PerformanceMonitor.gauge('cache.lru.hit_ms', Date.now() - start);
        return fallbackValue;
      }
      
      PerformanceMonitor.gauge('cache.miss_ms', Date.now() - start);
      return null;
      
    } catch (error) {
      console.error('Cache get error:', error);
      // Try fallback cache on error
      return this.fallbackCache.get(key) || null;
    }
  }
  
  /**
   * Set value in cache with advanced options
   */
  async set<T>(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<void> {
    const ttl = options.ttl || 300; // Default 5 minutes
    const expires = Date.now() + (ttl * 1000);
    const staleUntil = options.staleWhileRevalidate
      ? expires + (options.staleWhileRevalidate * 1000)
      : undefined;
      
    try {
      let processedValue: any = value;
      
      // Compress large values
      if (options.compress || JSON.stringify(value).length > 1024) {
        processedValue = await this.compress(value);
        options.compress = true;
      }
      
      const entry: CacheEntry<T> = {
        value: processedValue,
        expires,
        staleUntil,
        tags: options.tags,
        compressed: options.compress,
      };
      
      // Set in Redis
      if (this.redis) {
        await this.circuitBreaker.execute(async () => {
          await this.redis!.setex(
            this.prefixKey(key),
            ttl + (options.staleWhileRevalidate || 0),
            JSON.stringify(entry)
          );
          
          // Add to tag sets for invalidation
          if (options.tags) {
            for (const tag of options.tags) {
              await this.redis!.sadd(`tag:${tag}`, key);
              await this.redis!.expire(`tag:${tag}`, 86400); // 24 hours
            }
          }
        });
      }
      
      // Always set in fallback cache
      this.fallbackCache.set(key, value, { ttl: ttl * 1000 });
      
      // Notify subscribers
      this.notifySubscribers(key, value);
      
    } catch (error) {
      console.error('Cache set error:', error);
      // Still set in fallback cache
      this.fallbackCache.set(key, value, { ttl: ttl * 1000 });
    }
  }
  
  /**
   * Delete from cache
   */
  async delete(key: string): Promise<void> {
    try {
      if (this.redis) {
        await this.circuitBreaker.execute(async () => {
          await this.redis!.del(this.prefixKey(key));
        });
      }
      this.fallbackCache.delete(key);
      
      // Publish invalidation event
      if (this.redis) {
        await this.redis.publish(
          'cache:invalidate',
          JSON.stringify({ key })
        );
      }
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }
  
  /**
   * Invalidate by tags
   */
  async invalidateByTags(tags: string[]): Promise<void> {
    try {
      if (!this.redis) return;
      
      const keys = new Set<string>();
      
      // Get all keys for tags
      for (const tag of tags) {
        const taggedKeys = await this.redis.smembers(`tag:${tag}`);
        taggedKeys.forEach(k => keys.add(k));
      }
      
      // Delete all keys
      for (const key of keys) {
        await this.delete(key);
      }
      
      // Publish invalidation event
      await this.redis.publish(
        'cache:invalidate',
        JSON.stringify({ tags })
      );
      
    } catch (error) {
      console.error('Cache invalidate by tags error:', error);
    }
  }
  
  /**
   * Get or set with cache stampede prevention
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    // Check cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }
    
    // Check if already fetching
    const existingLock = this.locks.get(key);
    if (existingLock) {
      return existingLock;
    }
    
    // Create lock to prevent stampede
    const promise = (async () => {
      try {
        const value = await factory();
        await this.set(key, value, options);
        return value;
      } finally {
        this.locks.delete(key);
      }
    })();
    
    this.locks.set(key, promise);
    return promise;
  }
  
  /**
   * Subscribe to cache updates
   */
  subscribe<T>(key: string, callback: (value: T) => void): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    
    this.subscribers.get(key)!.add(callback);
    
    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(key);
      if (subs) {
        subs.delete(callback);
        if (subs.size === 0) {
          this.subscribers.delete(key);
        }
      }
    };
  }
  
  /**
   * Warm cache with predefined values
   */
  async warmCache(entries: Array<{ key: string; factory: () => Promise<any>; options?: CacheOptions }>) {
    await Promise.all(
      entries.map(({ key, factory, options }) =>
        this.getOrSet(key, factory, options).catch(err =>
          console.error(`Failed to warm cache for ${key}:`, err)
        )
      )
    );
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    return {
      redis: {
        connected: this.redis?.status === 'ready',
        circuitBreakerState: this.circuitBreaker['state'],
      },
      lru: {
        size: this.fallbackCache.size,
        calculatedSize: this.fallbackCache.calculatedSize,
      },
      locks: this.locks.size,
      subscribers: this.subscribers.size,
    };
  }
  
  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    try {
      if (this.redis) {
        await this.circuitBreaker.execute(async () => {
          const keys = await this.redis!.keys(this.prefixKey('*'));
          if (keys.length > 0) {
            await this.redis!.del(...keys);
          }
        });
      }
      this.fallbackCache.clear();
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  }
  
  /**
   * Helper methods
   */
  private prefixKey(key: string): string {
    return `poofpass:cache:${key}`;
  }
  
  private async compress(value: any): Promise<Buffer> {
    // Use native zlib compression
    const { promisify } = await import('util');
    const { gzip } = await import('zlib');
    const gzipAsync = promisify(gzip);
    
    const json = JSON.stringify(value);
    return gzipAsync(json);
  }
  
  private async decompress(buffer: Buffer): Promise<any> {
    const { promisify } = await import('util');
    const { gunzip } = await import('zlib');
    const gunzipAsync = promisify(gunzip);
    
    const json = await gunzipAsync(buffer);
    return JSON.parse(json.toString());
  }
  
  private async revalidateInBackground(key: string): Promise<void> {
    // This would trigger a background job to refresh the cache
    // Implementation depends on your background job system
    console.log(`Revalidating cache for key: ${key}`);
  }
  
  private handleInvalidation(key?: string, tags?: string[]) {
    if (key) {
      this.fallbackCache.delete(key);
    }
    
    if (tags) {
      // Remove all entries with matching tags from LRU cache
      // This is a simplified implementation
      for (const [k, v] of this.fallbackCache.entries()) {
        // Would need to store tags in LRU cache entries for this to work properly
        this.fallbackCache.delete(k);
      }
    }
  }
  
  private notifySubscribers(key: string, value: any) {
    const subscribers = this.subscribers.get(key);
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(value);
        } catch (error) {
          console.error('Subscriber callback error:', error);
        }
      });
    }
  }
}

// Export singleton instance
export const cache = new RedisCache();

// Cache decorators for easy use
export function Cacheable(options: CacheOptions = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const key = `${target.constructor.name}:${propertyKey}:${JSON.stringify(args)}`;
      
      return cache.getOrSet(
        key,
        () => originalMethod.apply(this, args),
        options
      );
    };
    
    return descriptor;
  };
}

export function CacheInvalidate(tags: string[]) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const result = await originalMethod.apply(this, args);
      await cache.invalidateByTags(tags);
      return result;
    };
    
    return descriptor;
  };
}
