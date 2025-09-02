import * as Sentry from '@sentry/nextjs';

// Metric types
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface Metric {
  name: string;
  type: MetricType;
  value: number;
  labels?: Record<string, string>;
  timestamp?: Date;
}

// Performance metrics
export class PerformanceMonitor {
  private static metrics: Map<string, Metric[]> = new Map();

  static startTimer(name: string, labels?: Record<string, string>): () => void {
    const start = performance.now();
    
    return () => {
      const duration = performance.now() - start;
      this.recordMetric({
        name: `${name}_duration_ms`,
        type: 'histogram',
        value: duration,
        labels,
      });

      // Alert on slow operations
      if (duration > 1000) {
        console.warn(`Slow operation detected: ${name} took ${duration}ms`);
        Sentry.captureMessage(`Slow operation: ${name}`, {
          level: 'warning',
          extra: { duration, labels },
        });
      }
    };
  }

  static recordMetric(metric: Metric) {
    const key = metric.name;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    
    this.metrics.get(key)!.push({
      ...metric,
      timestamp: metric.timestamp || new Date(),
    });

    // Send to external monitoring service
    this.sendToMonitoring(metric);
  }

  static increment(name: string, labels?: Record<string, string>, value = 1) {
    this.recordMetric({
      name,
      type: 'counter',
      value,
      labels,
    });
  }

  static gauge(name: string, value: number, labels?: Record<string, string>) {
    this.recordMetric({
      name,
      type: 'gauge',
      value,
      labels,
    });
  }

  private static async sendToMonitoring(metric: Metric) {
    // Send to Datadog, Prometheus, or other monitoring service
    // This is a placeholder - implement based on your monitoring stack
    if (process.env.DATADOG_API_KEY) {
      // Example: Send to Datadog
      try {
        await fetch('https://api.datadoghq.com/api/v1/series', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'DD-API-KEY': process.env.DATADOG_API_KEY,
          },
          body: JSON.stringify({
            series: [{
              metric: metric.name,
              points: [[Math.floor(Date.now() / 1000), metric.value]],
              type: metric.type,
              tags: metric.labels ? Object.entries(metric.labels).map(([k, v]) => `${k}:${v}`) : [],
            }],
          }),
        });
      } catch (error) {
        console.error('Failed to send metric to Datadog:', error);
      }
    }
  }

  static getMetrics(): Record<string, Metric[]> {
    return Object.fromEntries(this.metrics as any);
  }

  static reset() {
    this.metrics.clear();
  }
}

// Business metrics
export class BusinessMetrics {
  static recordPasswordCreation(userId: string, label?: string) {
    PerformanceMonitor.increment('passwords.created', {
      user_id: userId,
      has_label: label ? 'true' : 'false',
    });
  }

  static recordPasswordRotation(userId: string, autoRotated: boolean) {
    PerformanceMonitor.increment('passwords.rotated', {
      user_id: userId,
      auto_rotated: autoRotated ? 'true' : 'false',
    });
  }

  static recordCheckVerification(success: boolean, rotated: boolean) {
    PerformanceMonitor.increment('checks.verified', {
      success: success ? 'true' : 'false',
      rotated: rotated ? 'true' : 'false',
    });
  }

  static recordAuthEvent(event: 'login' | 'logout' | '2fa_enabled' | '2fa_verified', success: boolean) {
    PerformanceMonitor.increment(`auth.${event}`, {
      success: success ? 'true' : 'false',
    });
  }

  static recordBillingEvent(event: 'subscription_created' | 'subscription_cancelled' | 'payment_succeeded' | 'payment_failed') {
    PerformanceMonitor.increment(`billing.${event}`);
  }

  static recordApiCall(endpoint: string, method: string, statusCode: number, duration: number) {
    PerformanceMonitor.recordMetric({
      name: 'api.request_duration',
      type: 'histogram',
      value: duration,
      labels: {
        endpoint,
        method,
        status_code: statusCode.toString(),
        status_class: `${Math.floor(statusCode / 100)}xx`,
      },
    });

    PerformanceMonitor.increment('api.requests', {
      endpoint,
      method,
      status_code: statusCode.toString(),
    });
  }
}

// Health checks
export class HealthMonitor {
  static async checkDatabase(): Promise<boolean> {
    const timer = PerformanceMonitor.startTimer('health.database');
    try {
      // Implement database health check
      const response = await fetch('/api/health/db');
      const healthy = response.ok;
      
      PerformanceMonitor.gauge('health.database', healthy ? 1 : 0);
      return healthy;
    } catch (error) {
      PerformanceMonitor.gauge('health.database', 0);
      return false;
    } finally {
      timer();
    }
  }

  static async checkExternalServices(): Promise<Record<string, boolean>> {
    const services = {
      supabase: false,
      stripe: false,
      sentry: false,
    };

    // Check Supabase
    try {
      const response = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/', {
        method: 'HEAD',
      });
      services.supabase = response.ok;
    } catch {}

    // Check Stripe
    if (process.env.STRIPE_SECRET_KEY) {
      try {
        const response = await fetch('https://api.stripe.com/v1/charges', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
          },
        });
        services.stripe = response.ok;
      } catch {}
    }

    // Record metrics
    Object.entries(services).forEach(([service, healthy]) => {
      PerformanceMonitor.gauge(`health.external.${service}`, healthy ? 1 : 0);
    });

    return services;
  }

  static async performHealthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, boolean>;
  }> {
    const checks: Record<string, boolean> = {};
    
    // Database check
    checks.database = await this.checkDatabase();
    
    // External services
    const externalServices = await this.checkExternalServices();
    Object.assign(checks, externalServices);
    
    // Memory usage
    if (typeof process !== 'undefined') {
      const memUsage = process.memoryUsage();
      const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      checks.memory = heapUsedPercent < 90;
      
      PerformanceMonitor.gauge('system.memory.heap_used', memUsage.heapUsed);
      PerformanceMonitor.gauge('system.memory.heap_total', memUsage.heapTotal);
    }

    // Determine overall status
    const failedChecks = Object.values(checks).filter(v => !v).length;
    let status: 'healthy' | 'degraded' | 'unhealthy';
    
    if (failedChecks === 0) {
      status = 'healthy';
    } else if (failedChecks === 1 || !checks.database) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    PerformanceMonitor.gauge('health.status', status === 'healthy' ? 1 : status === 'degraded' ? 0.5 : 0);

    return { status, checks };
  }
}

// Custom error tracking
export class ErrorTracker {
  static trackError(error: Error, context?: Record<string, any>) {
    // Send to Sentry
    Sentry.captureException(error, {
      extra: context,
    });

    // Record metric
    PerformanceMonitor.increment('errors.total', {
      error_type: error.name,
      error_message: error.message.substring(0, 50),
    });
  }

  static trackApiError(
    endpoint: string,
    method: string,
    statusCode: number,
    error: any
  ) {
    PerformanceMonitor.increment('api.errors', {
      endpoint,
      method,
      status_code: statusCode.toString(),
      error_code: error?.code || 'unknown',
    });

    if (statusCode >= 500) {
      Sentry.captureException(new Error(`API Error: ${method} ${endpoint}`), {
        extra: {
          statusCode,
          error,
        },
      });
    }
  }

  static trackSecurityEvent(
    event: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    details: Record<string, any>
  ) {
    PerformanceMonitor.increment('security.events', {
      event,
      severity,
    });

    if (severity === 'high' || severity === 'critical') {
      Sentry.captureMessage(`Security Event: ${event}`, {
        level: severity === 'critical' ? 'error' : 'warning',
        extra: details,
      });
    }
  }
}

// Distributed tracing
export class Tracer {
  static startSpan(name: string, attributes?: Record<string, any>): Span {
    const span = new Span(name, attributes);
    
    // Send to tracing backend (e.g., Jaeger, Datadog APM)
    try {
      const transaction = (Sentry as any).startTransaction({
        name,
        op: attributes?.op || 'function',
        data: attributes,
      });
      span.sentrySpan = transaction;
    } catch {}

    return span;
  }
}

class Span {
  private startTime: number;
  public sentrySpan?: any;

  constructor(
    public name: string,
    public attributes?: Record<string, any>
  ) {
    this.startTime = performance.now();
  }

  setAttribute(key: string, value: any) {
    if (!this.attributes) {
      this.attributes = {};
    }
    this.attributes[key] = value;

    if (this.sentrySpan) {
      this.sentrySpan.setData(key, value);
    }
  }

  setStatus(status: 'ok' | 'error') {
    this.setAttribute('status', status);

    if (this.sentrySpan) {
      this.sentrySpan.setStatus(status === 'ok' ? 'ok' : 'internal_error');
    }
  }

  end() {
    const duration = performance.now() - this.startTime;
    
    PerformanceMonitor.recordMetric({
      name: `trace.${this.name}`,
      type: 'histogram',
      value: duration,
      labels: this.attributes,
    });

    if (this.sentrySpan) {
      this.sentrySpan.finish();
    }
  }
}
