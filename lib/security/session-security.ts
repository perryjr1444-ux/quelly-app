import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditLogger } from '@/lib/audit/logger';
import { EncryptionService } from '@/lib/crypto/encryption';

interface DeviceFingerprint {
  userAgent: string;
  acceptLanguage: string;
  acceptEncoding: string;
  screenResolution?: string;
  timezone?: string;
  platform?: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  colorDepth?: number;
  pixelRatio?: number;
  touchSupport?: boolean;
  webGL?: string;
  canvas?: string;
}

interface SessionMetadata {
  deviceId: string;
  fingerprint: string;
  ipAddress: string;
  geoLocation?: {
    country: string;
    city: string;
    lat: number;
    lon: number;
  };
  riskScore: number;
  trustScore: number;
}

export class SessionSecurityService {
  private static readonly SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly REFRESH_THRESHOLD = 60 * 60 * 1000; // 1 hour
  private static readonly MAX_SESSIONS_PER_USER = 5;
  private static readonly SUSPICIOUS_THRESHOLD = 0.7;
  
  /**
   * Generate device fingerprint from request data
   */
  static generateFingerprint(data: DeviceFingerprint): string {
    const fingerprintData = [
      data.userAgent,
      data.acceptLanguage,
      data.acceptEncoding,
      data.screenResolution || '',
      data.timezone || '',
      data.platform || '',
      data.hardwareConcurrency?.toString() || '',
      data.deviceMemory?.toString() || '',
      data.colorDepth?.toString() || '',
      data.pixelRatio?.toString() || '',
      data.touchSupport ? '1' : '0',
      data.webGL || '',
      data.canvas || ''
    ].join('|');
    
    return EncryptionService.hash(fingerprintData);
  }
  
  /**
   * Calculate risk score based on various factors
   */
  static async calculateRiskScore(
    userId: string,
    sessionMetadata: Partial<SessionMetadata>
  ): Promise<number> {
    let riskScore = 0;
    const supabase = createAdminClient();
    
    // Check for known device
    const { data: knownDevices } = await supabase
      .from('user_devices')
      .select('device_id, trust_score')
      .eq('user_id', userId)
      .eq('device_id', sessionMetadata.deviceId || '');
      
    if (!knownDevices || knownDevices.length === 0) {
      riskScore += 0.3; // New device
    }
    
    // Check for unusual location
    if (sessionMetadata.geoLocation) {
      const { data: recentSessions } = await supabase
        .from('user_sessions')
        .select('geo_country, geo_city')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);
        
      if (recentSessions) {
        const differentCountry = !recentSessions.some(
          s => s.geo_country === sessionMetadata.geoLocation?.country
        );
        if (differentCountry) {
          riskScore += 0.4; // Different country
        }
      }
    }
    
    // Check for concurrent sessions
    const { count: activeSessions } = await supabase
      .from('user_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('revoked_at', null)
      .gte('expires_at', new Date().toISOString());
      
    if ((activeSessions || 0) > 3) {
      riskScore += 0.2; // Many active sessions
    }
    
    // Check for rapid session creation
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentAttempts } = await supabase
      .from('user_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', oneHourAgo);
      
    if ((recentAttempts || 0) > 5) {
      riskScore += 0.3; // Too many recent attempts
    }
    
    // Normalize to 0-1 range
    return Math.min(riskScore, 1);
  }
  
  /**
   * Create secure session with enhanced tracking
   */
  static async createSecureSession(
    userId: string,
    deviceFingerprint: DeviceFingerprint,
    ipAddress: string,
    require2FA: boolean = false
  ): Promise<{
    sessionId: string;
    token: string;
    requiresVerification: boolean;
    expiresAt: Date;
  }> {
    const supabase = createAdminClient();
    const sessionId = crypto.randomUUID();
    const token = EncryptionService.generateSecureRandom(64);
    const deviceId = this.generateFingerprint(deviceFingerprint);
    
    // Get geolocation from IP (you would integrate with a service like MaxMind)
    const geoLocation = await this.getGeoLocation(ipAddress) || undefined;
    
    // Calculate risk score
    const riskScore = await this.calculateRiskScore(userId, {
      deviceId,
      fingerprint: deviceId,
      ipAddress,
      geoLocation
    });
    
    // Determine if additional verification is needed
    const requiresVerification = riskScore > this.SUSPICIOUS_THRESHOLD || require2FA;
    
    const expiresAt = new Date(Date.now() + this.SESSION_DURATION);
    
    // Store session
    await supabase.from('user_sessions').insert({
      id: sessionId,
      user_id: userId,
      device_id: deviceId,
      device_fingerprint: deviceId,
      user_agent: deviceFingerprint.userAgent,
      ip_address: ipAddress,
      geo_country: geoLocation?.country,
      geo_city: geoLocation?.city,
      geo_lat: geoLocation?.lat,
      geo_lon: geoLocation?.lon,
      risk_score: riskScore,
      token_hash: EncryptionService.hash(token),
      verified: !requiresVerification,
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString()
    });
    
    // Update or create device record
    await supabase.from('user_devices').upsert({
      user_id: userId,
      device_id: deviceId,
      fingerprint: deviceId,
      last_seen: new Date().toISOString(),
      trust_score: Math.max(0, 1 - riskScore),
      platform: deviceFingerprint.platform,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,device_id'
    });
    
    // Log session creation
    await auditLogger.log({
      action: 'session_created',
      resourceType: 'auth',
      userId,
      metadata: {
        sessionId,
        deviceId,
        riskScore,
        requiresVerification
      },
      status: 'success'
    });
    
    // Enforce session limit
    await this.enforceSessionLimit(userId);
    
    return {
      sessionId,
      token,
      requiresVerification,
      expiresAt
    };
  }
  
  /**
   * Validate session with security checks
   */
  static async validateSecureSession(
    sessionId: string,
    token: string,
    currentFingerprint?: DeviceFingerprint
  ): Promise<{
    valid: boolean;
    userId?: string;
    requiresRefresh?: boolean;
    suspiciousActivity?: boolean;
  }> {
    const supabase = createAdminClient();
    
    const { data: session } = await supabase
      .from('user_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
      
    if (!session) {
      return { valid: false };
    }
    
    // Check token
    const tokenValid = EncryptionService.secureCompare(
      EncryptionService.hash(token),
      session.token_hash
    );
    
    if (!tokenValid) {
      await auditLogger.logSecurityEvent('auth_failure', {
        reason: 'invalid_session_token',
        sessionId
      });
      return { valid: false };
    }
    
    // Check expiration
    if (new Date(session.expires_at) < new Date()) {
      return { valid: false };
    }
    
    // Check if revoked
    if (session.revoked_at) {
      return { valid: false };
    }
    
    // Check device fingerprint if provided
    let suspiciousActivity = false;
    if (currentFingerprint) {
      const currentDeviceId = this.generateFingerprint(currentFingerprint);
      if (currentDeviceId !== session.device_id) {
        suspiciousActivity = true;
        await auditLogger.logSecurityEvent('suspicious_activity', {
          reason: 'device_fingerprint_mismatch',
          sessionId,
          userId: session.user_id
        });
      }
    }
    
    // Check if refresh needed
    const sessionAge = Date.now() - new Date(session.created_at).getTime();
    const requiresRefresh = sessionAge > this.REFRESH_THRESHOLD;
    
    // Update last activity
    await supabase
      .from('user_sessions')
      .update({ 
        last_activity: new Date().toISOString(),
        last_ip: session.ip_address // You would pass current IP
      })
      .eq('id', sessionId);
    
    return {
      valid: true,
      userId: session.user_id,
      requiresRefresh,
      suspiciousActivity
    };
  }
  
  /**
   * Revoke session
   */
  static async revokeSession(sessionId: string, reason?: string): Promise<void> {
    const supabase = createAdminClient();
    
    const { data: session } = await supabase
      .from('user_sessions')
      .update({ 
        revoked_at: new Date().toISOString(),
        revoke_reason: reason 
      })
      .eq('id', sessionId)
      .select('user_id')
      .single();
      
    if (session) {
    await auditLogger.log({
        action: 'session_revoked',
        resourceType: 'auth',
        userId: session.user_id,
      metadata: { sessionId, reason },
      status: 'success'
      });
    }
  }
  
  /**
   * Revoke all sessions for a user
   */
  static async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
    const supabase = createAdminClient();
    
    let query = supabase
      .from('user_sessions')
      .update({ 
        revoked_at: new Date().toISOString(),
        revoke_reason: 'bulk_revoke' 
      })
      .eq('user_id', userId)
      .is('revoked_at', null);
      
    if (exceptSessionId) {
      query = query.neq('id', exceptSessionId);
    }
    
    await query;
    
    await auditLogger.log({
      action: 'all_sessions_revoked',
      resourceType: 'auth',
      userId,
      metadata: { exceptSessionId },
      status: 'success'
    });
  }
  
  /**
   * Enforce maximum session limit per user
   */
  private static async enforceSessionLimit(userId: string): Promise<void> {
    const supabase = createAdminClient();
    
    // Get all active sessions ordered by creation time
    const { data: sessions } = await supabase
      .from('user_sessions')
      .select('id')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: true });
      
    if (sessions && sessions.length > this.MAX_SESSIONS_PER_USER) {
      // Revoke oldest sessions
      const sessionsToRevoke = sessions.slice(0, sessions.length - this.MAX_SESSIONS_PER_USER);
      
      for (const session of sessionsToRevoke) {
        await this.revokeSession(session.id, 'session_limit_exceeded');
      }
    }
  }
  
  /**
   * Get geolocation from IP address
   * Note: This is a placeholder - integrate with MaxMind or similar service
   */
  private static async getGeoLocation(ipAddress: string): Promise<{
    country: string;
    city: string;
    lat: number;
    lon: number;
  } | null> {
    // Placeholder implementation
    // In production, use MaxMind GeoIP2 or similar service
    return null;
  }
  
  /**
   * Detect anomalies in user behavior
   */
  static async detectAnomalies(userId: string): Promise<{
    anomalies: string[];
    riskLevel: 'low' | 'medium' | 'high';
  }> {
    const supabase = createAdminClient();
    const anomalies: string[] = [];
    
    // Check for impossible travel
    const { data: recentSessions } = await supabase
      .from('user_sessions')
      .select('geo_lat, geo_lon, created_at')
      .eq('user_id', userId)
      .not('geo_lat', 'is', null)
      .order('created_at', { ascending: false })
      .limit(2);
      
    if (recentSessions && recentSessions.length === 2) {
      const timeDiff = new Date(recentSessions[0].created_at).getTime() - 
                       new Date(recentSessions[1].created_at).getTime();
      const distance = this.calculateDistance(
        recentSessions[0].geo_lat,
        recentSessions[0].geo_lon,
        recentSessions[1].geo_lat,
        recentSessions[1].geo_lon
      );
      
      // If traveling faster than 1000 km/h, it's suspicious
      const speed = distance / (timeDiff / 3600000); // km/h
      if (speed > 1000) {
        anomalies.push('impossible_travel');
      }
    }
    
    // Check for unusual activity patterns
    const { data: activityPattern } = await supabase
      .from('user_sessions')
      .select('created_at')
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      
    if (activityPattern) {
      // Group by hour
      const hourCounts = new Map<number, number>();
      activityPattern.forEach(session => {
        const hour = new Date(session.created_at).getHours();
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
      });
      
      // Check for unusual spikes
      const avgActivity = Array.from(hourCounts.values()).reduce((a, b) => a + b, 0) / 24;
      const maxActivity = Math.max(...Array.from(hourCounts.values()));
      
      if (maxActivity > avgActivity * 5) {
        anomalies.push('unusual_activity_spike');
      }
    }
    
    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    if (anomalies.length >= 2) {
      riskLevel = 'high';
    } else if (anomalies.length === 1) {
      riskLevel = 'medium';
    }
    
    if (anomalies.length > 0) {
      await auditLogger.logSecurityEvent('suspicious_activity', {
        userId,
        anomalies,
        riskLevel
      });
    }
    
    return { anomalies, riskLevel };
  }
  
  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  private static calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
}

// No singleton export; use static methods directly
