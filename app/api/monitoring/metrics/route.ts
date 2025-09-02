import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PerformanceMonitor, HealthMonitor } from '@/lib/monitoring/metrics';
import { withErrorHandling } from '@/lib/errors/handler';
import { AuthorizationError } from '@/lib/errors/handler';
import type { ApiResponse } from '@/types/api';

export const GET = withErrorHandling(
  async (req: NextRequest) => {
    // Admin only endpoint
    const supabase = createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error || !user) {
      throw new AuthorizationError();
    }

    // Check admin role
    const { data: member } = await supabase
      .from('org_members')
      .select('role')
      .eq('user_id', user.id)
      .single();
      
    if (member?.role !== 'admin') {
      throw new AuthorizationError('Admin access required');
    }

    // Get query parameters
    const { searchParams } = new URL(req.url);
    const format = searchParams.get('format') || 'json';

    // Collect all metrics
    const metrics = PerformanceMonitor.getMetrics();
    const health = await HealthMonitor.performHealthCheck();
    
    // Get database statistics
    const dbStats = await getDatabaseStats(supabase);
    
    // Get API statistics
    const apiStats = await getApiStats(supabase);

    if (format === 'prometheus') {
      // Format metrics in Prometheus format
      const prometheusMetrics = formatPrometheusMetrics(metrics, health, dbStats, apiStats);
      
      return new NextResponse(prometheusMetrics, {
        headers: {
          'Content-Type': 'text/plain; version=0.0.4',
        },
      });
    }

    // Return JSON format
    return NextResponse.json<ApiResponse<any>>({
      ok: true,
      data: {
        timestamp: new Date().toISOString(),
        health,
        metrics,
        database: dbStats,
        api: apiStats,
        system: getSystemMetrics(),
      },
    });
  },
  { action: 'view_metrics', resourceType: 'monitoring' }
);

async function getDatabaseStats(supabase: any) {
  try {
    // Get table sizes and counts
    const tables = [
      'disposable_passwords',
      'password_references',
      'check_credentials',
      'audit_logs',
      'user_sessions',
    ];

    const stats: Record<string, any> = {};

    for (const table of tables) {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
        
      if (!error) {
        stats[`${table}_count`] = count || 0;
      }
    }

    // Get active user count (last 24h)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const { count: activeUsers } = await supabase
      .from('audit_logs')
      .select('user_id', { count: 'exact', head: true })
      .gte('created_at', yesterday.toISOString())
      .not('user_id', 'is', null);
      
    stats.active_users_24h = activeUsers || 0;

    return stats;
  } catch (error) {
    console.error('Failed to get database stats:', error);
    return {};
  }
}

async function getApiStats(supabase: any) {
  try {
    const stats: Record<string, any> = {};
    
    // Get API call counts by endpoint (last hour)
    const hourAgo = new Date();
    hourAgo.setHours(hourAgo.getHours() - 1);
    
    const { data: recentLogs } = await supabase
      .from('audit_logs')
      .select('action, status')
      .gte('created_at', hourAgo.toISOString())
      .limit(1000);
      
    if (recentLogs) {
      // Count by action
      const actionCounts: Record<string, number> = {};
      const statusCounts: Record<string, number> = {};
      
      for (const log of recentLogs) {
        actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
        statusCounts[log.status] = (statusCounts[log.status] || 0) + 1;
      }
      
      stats.requests_per_hour = recentLogs.length;
      stats.actions = actionCounts;
      stats.statuses = statusCounts;
      stats.error_rate = (statusCounts.error || 0) / recentLogs.length;
    }

    return stats;
  } catch (error) {
    console.error('Failed to get API stats:', error);
    return {};
  }
}

function getSystemMetrics() {
  if (typeof process === 'undefined') {
    return {};
  }

  const memUsage = process.memoryUsage();
  const uptime = process.uptime();

  return {
    memory: {
      heap_used: memUsage.heapUsed,
      heap_total: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
    },
    uptime_seconds: uptime,
    node_version: process.version,
    platform: process.platform,
    cpu_usage: process.cpuUsage(),
  };
}

function formatPrometheusMetrics(
  metrics: Record<string, any[]>,
  health: any,
  dbStats: Record<string, any>,
  apiStats: Record<string, any>
): string {
  const lines: string[] = [];
  
  // Health metrics
  lines.push(`# HELP health_status Overall health status (1=healthy, 0.5=degraded, 0=unhealthy)`);
  lines.push(`# TYPE health_status gauge`);
  lines.push(`health_status ${health.status === 'healthy' ? 1 : health.status === 'degraded' ? 0.5 : 0}`);
  
  // Health checks
  for (const [check, status] of Object.entries(health.checks)) {
    lines.push(`health_check{check="${check}"} ${status ? 1 : 0}`);
  }
  
  // Database metrics
  for (const [key, value] of Object.entries(dbStats)) {
    if (typeof value === 'number') {
      lines.push(`database_${key} ${value}`);
    }
  }
  
  // API metrics
  if (apiStats.requests_per_hour) {
    lines.push(`api_requests_per_hour ${apiStats.requests_per_hour}`);
  }
  if (apiStats.error_rate) {
    lines.push(`api_error_rate ${apiStats.error_rate}`);
  }
  
  // Custom metrics
  for (const [metricName, values] of Object.entries(metrics)) {
    if (Array.isArray(values) && values.length > 0) {
      const latestValue = values[values.length - 1];
      
      if (latestValue.type === 'counter') {
        lines.push(`# TYPE ${metricName} counter`);
      } else if (latestValue.type === 'gauge') {
        lines.push(`# TYPE ${metricName} gauge`);
      } else if (latestValue.type === 'histogram') {
        lines.push(`# TYPE ${metricName} histogram`);
      }
      
      const labels = latestValue.labels 
        ? `{${Object.entries(latestValue.labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
        : '';
        
      lines.push(`${metricName}${labels} ${latestValue.value}`);
    }
  }
  
  return lines.join('\n');
}
