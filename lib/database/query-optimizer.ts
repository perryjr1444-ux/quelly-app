import { SupabaseClient } from '@supabase/supabase-js';
import { apiCache, CacheKeyBuilder } from '@/lib/cache';

export interface QueryOptions {
  cache?: boolean;
  cacheTTL?: number;
  select?: string;
  limit?: number;
  offset?: number;
  orderBy?: { column: string; ascending?: boolean };
  filters?: Record<string, any>;
}

export class QueryOptimizer {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Optimized query with caching and batching
   */
  async query<T>(
    table: string,
    options: QueryOptions = {}
  ): Promise<T[]> {
    const {
      cache = true,
      cacheTTL,
      select = '*',
      limit,
      offset,
      orderBy,
      filters = {},
    } = options;

    // Build cache key
    const cacheKey = new CacheKeyBuilder('query')
      .add(table)
      .add(select)
      .addHash({ limit, offset, orderBy, filters })
      .build();

    // Use cache if enabled
    if (cache) {
      return apiCache.getOrSet(
        cacheKey,
        () => this.executeQuery<T>(table, options),
        cacheTTL
      );
    }

    return this.executeQuery<T>(table, options);
  }

  private async executeQuery<T>(
    table: string,
    options: QueryOptions
  ): Promise<T[]> {
    let query = this.supabase.from(table).select(options.select || '*');

    // Apply filters
    if (options.filters) {
      for (const [key, value] of Object.entries(options.filters)) {
        if (value === null) {
          query = query.is(key, null);
        } else if (Array.isArray(value)) {
          query = query.in(key, value);
        } else {
          query = query.eq(key, value);
        }
      }
    }

    // Apply ordering
    if (options.orderBy) {
      query = query.order(options.orderBy.column, {
        ascending: options.orderBy.ascending ?? true,
      });
    }

    // Apply pagination
    if (options.limit) {
      query = query.limit(options.limit);
    }
    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return (data || []) as T[];
  }

  /**
   * Batch fetch multiple records by IDs
   */
  async batchGet<T>(
    table: string,
    ids: string[],
    options: { select?: string; cache?: boolean } = {}
  ): Promise<Map<string, T>> {
    if (ids.length === 0) {
      return new Map();
    }

    // Deduplicate IDs
    const uniqueIds = [...new Set(ids)];
    
    // Split into chunks to avoid query size limits
    const chunks = this.chunkArray(uniqueIds, 100);
    const results = new Map<string, T>();

    await Promise.all(
      chunks.map(async (chunk) => {
        const items = await this.query<T & { id: string }>(table, {
          select: options.select,
          filters: { id: chunk },
          cache: options.cache ?? true,
        });

        for (const item of items) {
          results.set(item.id, item);
        }
      })
    );

    return results;
  }

  /**
   * Cursor-based pagination for large datasets
   */
  async *paginate<T>(
    table: string,
    options: {
      select?: string;
      pageSize?: number;
      orderBy: { column: string; ascending?: boolean };
      filters?: Record<string, any>;
    }
  ): AsyncGenerator<T[], void, unknown> {
    const { pageSize = 100, orderBy, filters = {} } = options;
    let lastValue: any = null;
    let hasMore = true;

    while (hasMore) {
      let query = this.supabase
        .from(table)
        .select(options.select || '*')
        .limit(pageSize)
        .order(orderBy.column, { ascending: orderBy.ascending ?? true });

      // Apply filters
      for (const [key, value] of Object.entries(filters)) {
        query = query.eq(key, value);
      }

      // Apply cursor
      if (lastValue !== null) {
        const op = orderBy.ascending ? 'gt' : 'lt';
        query = query[op](orderBy.column, lastValue);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      yield data as T[];

      // Update cursor
      const lastItem = data[data.length - 1] as any;
      lastValue = lastItem[orderBy.column];
      hasMore = data.length === pageSize;
    }
  }

  /**
   * Execute multiple queries in parallel
   */
  async parallel<T extends Record<string, any>>(
    queries: {
      [K in keyof T]: {
        table: string;
        options?: QueryOptions;
      };
    }
  ): Promise<T> {
    const entries = Object.entries(queries) as Array<
      [keyof T, { table: string; options?: QueryOptions }]
    >;

    const results = await Promise.all(
      entries.map(async ([key, { table, options }]) => {
        const data = await this.query(table, options);
        return [key, data];
      })
    );

    return Object.fromEntries(results) as T;
  }

  /**
   * Count query with caching
   */
  async count(
    table: string,
    filters: Record<string, any> = {},
    cache = true
  ): Promise<number> {
    const cacheKey = new CacheKeyBuilder('count')
      .add(table)
      .addHash(filters)
      .build();

    if (cache) {
      return apiCache.getOrSet(cacheKey, async () => {
        let query = this.supabase
          .from(table)
          .select('*', { count: 'exact', head: true });

        for (const [key, value] of Object.entries(filters)) {
          query = query.eq(key, value);
        }

        const { count, error } = await query;

        if (error) {
          throw error;
        }

        return count || 0;
      });
    }

    let query = this.supabase
      .from(table)
      .select('*', { count: 'exact', head: true });

    for (const [key, value] of Object.entries(filters)) {
      query = query.eq(key, value);
    }

    const { count, error } = await query;

    if (error) {
      throw error;
    }

    return count || 0;
  }

  /**
   * Upsert with conflict resolution
   */
  async upsert<T>(
    table: string,
    data: Partial<T> | Partial<T>[],
    options: {
      onConflict?: string;
      returning?: boolean;
      cache?: boolean;
    } = {}
  ): Promise<T | T[] | null> {
    const { onConflict, returning = true, cache = false } = options;

    const { data: result, error } = await this.supabase
      .from(table)
      .upsert(data, { onConflict })
      .select();

    if (error) {
      throw error;
    }

    // Invalidate cache for this table
    if (!cache) {
      await apiCache.invalidatePattern(`query:${table}:*`);
      await apiCache.invalidatePattern(`count:${table}:*`);
    }

    return returning ? result : null;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// Connection pooling configuration
export const connectionPoolConfig = {
  // Supabase handles connection pooling internally
  // These are recommendations for client-side optimization
  maxConnections: 10,
  idleTimeout: 30000, // 30 seconds
  connectionTimeout: 5000, // 5 seconds
};

// Query performance monitoring
export class QueryMonitor {
  private static queries: Map<string, { count: number; totalTime: number }> = new Map();

  static async monitor<T>(
    queryName: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = performance.now();
    
    try {
      const result = await fn();
      const duration = performance.now() - start;
      
      this.recordQuery(queryName, duration);
      
      if (duration > 1000) {
        console.warn(`Slow query detected: ${queryName} took ${duration}ms`);
      }
      
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.recordQuery(queryName, duration, true);
      throw error;
    }
  }

  private static recordQuery(name: string, duration: number, error = false) {
    const stats = this.queries.get(name) || { count: 0, totalTime: 0 };
    stats.count++;
    stats.totalTime += duration;
    this.queries.set(name, stats);

    if (error) {
      console.error(`Query error: ${name} after ${duration}ms`);
    }
  }

  static getStats() {
    const stats: any[] = [];
    
    for (const [name, data] of this.queries.entries()) {
      stats.push({
        query: name,
        count: data.count,
        totalTime: data.totalTime,
        avgTime: data.totalTime / data.count,
      });
    }

    return stats.sort((a, b) => b.totalTime - a.totalTime);
  }

  static reset() {
    this.queries.clear();
  }
}
