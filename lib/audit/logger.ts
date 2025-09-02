import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

export interface AuditEvent {
  id?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  userId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  duration?: number;
  status: 'success' | 'failure' | 'error';
  errorMessage?: string;
  timestamp?: string;
}

export interface AuditContext {
  userId?: string;
  orgId?: string;
  sessionId?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  duration?: number;
}

class AuditLogger {
  private queue: AuditEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly maxQueueSize = 100;
  private readonly flushIntervalMs = 5000;

  constructor() {
    // Start the flush interval
    if (typeof window === 'undefined') {
      this.startFlushInterval();
    }
  }

  private startFlushInterval() {
    this.flushInterval = setInterval(() => {
      this.flush().catch(console.error);
    }, this.flushIntervalMs);
  }

  async log(event: AuditEvent): Promise<void> {
    // Add timestamp
    const auditEntry = {
      ...event,
      timestamp: new Date().toISOString(),
      id: this.generateEventId(),
      status: event.status || 'success',
    };

    // Add to queue
    this.queue.push(auditEntry);

    // Flush if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      await this.flush();
    }
  }

  async logRequest(
    req: NextRequest,
    action: string,
    resourceType: string,
    resourceId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const context = await this.extractContext(req);
    
    await this.log({
      action,
      resourceType,
      resourceId,
      userId: context.userId,
      metadata: {
        ...metadata,
        orgId: context.orgId,
        sessionId: context.sessionId,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
      status: 'success',
    });
  }

  async logError(
    action: string,
    resourceType: string,
    error: Error,
    context?: Partial<AuditContext>
  ): Promise<void> {
    await this.log({
      action,
      resourceType,
      userId: context?.userId,
      metadata: {
        errorName: error.name,
        errorStack: error.stack,
        ...context,
      },
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
      status: 'error',
      errorMessage: error.message,
    });
  }

  async logSecurityEvent(
    eventType: 'auth_failure' | 'permission_denied' | 'suspicious_activity' | 'data_breach_attempt',
    details: Record<string, any>,
    context?: Partial<AuditContext>
  ): Promise<void> {
    // Security events are high priority - flush immediately
    await this.log({
      action: eventType,
      resourceType: 'security',
      metadata: {
        ...details,
        severity: this.getSecuritySeverity(eventType),
      },
      userId: context?.userId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      requestId: context?.requestId,
      status: 'failure',
    });
    
    await this.flush();
  }

  async extractContext(req: NextRequest): Promise<AuditContext> {
    const context: AuditContext = {
      requestId: req.headers.get('x-request-id') || undefined,
      ipAddress: this.getClientIp(req),
      userAgent: req.headers.get('user-agent') || undefined,
    };

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        context.userId = user.id;
        
        // Get org context
        const { data: member } = await supabase
          .from('org_members')
          .select('org_id')
          .eq('user_id', user.id)
          .maybeSingle();
          
        if (member) {
          context.orgId = member.org_id;
        }
      }
      
      // Get session ID from cookie
      const sessionCookie = req.cookies.get('sb-session-id');
      if (sessionCookie) {
        context.sessionId = sessionCookie.value;
      }
    } catch (error) {
      console.error('Failed to extract audit context:', error);
    }

    return context;
  }

  private getClientIp(req: NextRequest): string {
    const headers = [
      'cf-connecting-ip',
      'x-forwarded-for',
      'x-real-ip',
      'x-client-ip',
    ];

    for (const header of headers) {
      const value = req.headers.get(header);
      if (value) {
        if (header === 'x-forwarded-for') {
          return value.split(',')[0].trim();
        }
        return value;
      }
    }

    return 'unknown';
  }

  private generateEventId(): string {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 9);
    return `evt_${timestamp}_${random}`;
  }

  private getSecuritySeverity(eventType: string): 'low' | 'medium' | 'high' | 'critical' {
    switch (eventType) {
      case 'auth_failure':
        return 'medium';
      case 'permission_denied':
        return 'medium';
      case 'suspicious_activity':
        return 'high';
      case 'data_breach_attempt':
        return 'critical';
      default:
        return 'low';
    }
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const events = [...this.queue];
    this.queue = [];

    try {
      const supabase = createAdminClient();
      
      // Batch insert audit events
      const { error } = await supabase
        .from('audit_logs')
        .insert(events.map(event => ({
          event_id: event.id,
          timestamp: event.timestamp,
          action: event.action,
          resource_type: event.resourceType,
          resource_id: event.resourceId,
          user_id: event.userId,
          metadata: event.metadata,
          ip_address: event.ipAddress,
          user_agent: event.userAgent,
          request_id: event.requestId,
          duration_ms: event.duration,
          status: event.status,
          error_message: event.errorMessage,
        })));

      if (error) {
        console.error('Failed to flush audit logs:', error);
        // Re-add events to queue for retry
        this.queue.unshift(...events);
      }
    } catch (error) {
      console.error('Failed to flush audit logs:', error);
      // Re-add events to queue for retry
      this.queue.unshift(...events);
    }
  }

  destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    // Final flush
    this.flush().catch(console.error);
  }
}

// Global audit logger instance
export const auditLogger = new AuditLogger();

// Audit middleware
export function withAudit<T extends (...args: any[]) => Promise<any>>(
  action: string,
  resourceType: string,
  handler: T
): T {
  return (async (...args: Parameters<T>) => {
    const startTime = Date.now();
    const req = args[0] as NextRequest;
    
    try {
      const result = await handler(...args);
      
      // Log successful action
      await auditLogger.logRequest(req, action, resourceType, undefined, {
        duration: Date.now() - startTime,
      });
      
      return result;
    } catch (error) {
      // Log failed action
      const context = await auditLogger['extractContext'](req);
      await auditLogger.logError(action, resourceType, error as Error, {
        ...context,
        duration: Date.now() - startTime,
      });
      
      throw error;
    }
  }) as T;
}

// Compliance reporting
export class ComplianceReporter {
  async generateReport(
    startDate: Date,
    endDate: Date,
    filters?: {
      userId?: string;
      action?: string;
      resourceType?: string;
    }
  ): Promise<any> {
    const supabase = createAdminClient();
    
    let query = supabase
      .from('audit_logs')
      .select('*')
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString())
      .order('timestamp', { ascending: false });

    if (filters?.userId) {
      query = query.eq('user_id', filters.userId);
    }
    if (filters?.action) {
      query = query.eq('action', filters.action);
    }
    if (filters?.resourceType) {
      query = query.eq('resource_type', filters.resourceType);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to generate compliance report: ${error.message}`);
    }

    // Generate summary statistics
    const summary = {
      totalEvents: data.length,
      uniqueUsers: new Set(data.map(e => e.user_id).filter(Boolean)).size,
      actionBreakdown: this.groupBy(data, 'action'),
      resourceBreakdown: this.groupBy(data, 'resource_type'),
      errorRate: data.filter(e => e.status === 'error').length / data.length,
      topUsers: this.getTopUsers(data),
    };

    return {
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      summary,
      events: data,
    };
  }

  private groupBy(data: any[], key: string): Record<string, number> {
    return data.reduce((acc, item) => {
      const value = item[key] || 'unknown';
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  }

  private getTopUsers(data: any[]): Array<{ userId: string; count: number }> {
    const userCounts = this.groupBy(data.filter(e => e.user_id), 'user_id');
    return Object.entries(userCounts)
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }
}
