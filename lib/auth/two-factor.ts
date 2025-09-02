import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createHash, createHmac, randomBytes } from 'crypto';
import { auditLogger } from '@/lib/audit/logger';

// Constants
const TOTP_WINDOW = 1; // Allow 1 step before/after for clock skew
const TOTP_DIGITS = 6;
const TOTP_PERIOD = 30; // seconds
const BACKUP_CODES_COUNT = 10;

export interface TwoFactorSecret {
  userId: string;
  secret: string;
  backupCodes: string[];
  enabled: boolean;
  verifiedAt?: string;
}

export class TwoFactorAuth {
  /**
   * Generate a new TOTP secret for a user
   */
  async generateSecret(userId: string): Promise<{
    secret: string;
    qrCode: string;
    backupCodes: string[];
  }> {
    // Generate random secret (160 bits for compatibility)
    const secret = this.generateBase32Secret(20);
    
    // Generate backup codes
    const backupCodes = this.generateBackupCodes();
    
    // Store in database (encrypted)
    const supabase = createAdminClient();
    const encryptedSecret = await this.encryptSecret(secret);
    const hashedBackupCodes = backupCodes.map(code => this.hashBackupCode(code));
    
    await supabase.from('two_factor_secrets').upsert({
      user_id: userId,
      secret: encryptedSecret,
      backup_codes: hashedBackupCodes,
      enabled: false,
      created_at: new Date().toISOString(),
    });
    
    // Generate QR code URL
    const issuer = 'PoofPass';
    const { data: user } = await supabase.auth.admin.getUserById(userId);
    const accountName = user?.user?.email || userId;
    
    const otpauth = `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
    
    // Generate QR code data URL (you'll need to add qrcode package)
    const qrCode = otpauth; // In real implementation, use QRCode.toDataURL(otpauth)
    
    await auditLogger.log({
      action: '2fa_secret_generated',
      resourceType: 'auth',
      userId,
      status: 'success',
    });
    
    return { secret, qrCode, backupCodes };
  }
  
  /**
   * Verify TOTP code and enable 2FA
   */
  async verifyAndEnable(userId: string, code: string): Promise<boolean> {
    const supabase = createAdminClient();
    
    // Get user's secret
    const { data: tfaData } = await supabase
      .from('two_factor_secrets')
      .select('secret, enabled')
      .eq('user_id', userId)
      .single();
      
    if (!tfaData || tfaData.enabled) {
      return false;
    }
    
    const secret = await this.decryptSecret(tfaData.secret);
    
    // Verify the code
    if (!this.verifyTOTP(secret, code)) {
      await auditLogger.logSecurityEvent('auth_failure', {
        reason: '2fa_verification_failed',
        userId,
      });
      return false;
    }
    
    // Enable 2FA
    await supabase
      .from('two_factor_secrets')
      .update({
        enabled: true,
        verified_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
      
    await auditLogger.log({
      action: '2fa_enabled',
      resourceType: 'auth',
      userId,
      status: 'success',
    });
    
    return true;
  }
  
  /**
   * Verify TOTP code for authentication
   */
  async verify(userId: string, code: string): Promise<boolean> {
    const supabase = createAdminClient();
    
    // Get user's secret
    const { data: tfaData } = await supabase
      .from('two_factor_secrets')
      .select('secret, enabled, last_used_counter')
      .eq('user_id', userId)
      .single();
      
    if (!tfaData || !tfaData.enabled) {
      return false;
    }
    
    const secret = await this.decryptSecret(tfaData.secret);
    
    // Check if it's a backup code
    if (code.length > TOTP_DIGITS) {
      return this.verifyBackupCode(userId, code);
    }
    
    // Verify TOTP
    const counter = this.getCurrentCounter();
    if (!this.verifyTOTP(secret, code, counter)) {
      await auditLogger.logSecurityEvent('auth_failure', {
        reason: '2fa_invalid_code',
        userId,
      });
      return false;
    }
    
    // Prevent replay attacks
    if (tfaData.last_used_counter && counter <= tfaData.last_used_counter) {
      await auditLogger.logSecurityEvent('suspicious_activity', {
        reason: '2fa_replay_attempt',
        userId,
        counter,
      });
      return false;
    }
    
    // Update last used counter
    await supabase
      .from('two_factor_secrets')
      .update({ last_used_counter: counter })
      .eq('user_id', userId);
      
    await auditLogger.log({
      action: '2fa_verified',
      resourceType: 'auth',
      userId,
      status: 'success',
    });
    
    return true;
  }
  
  /**
   * Disable 2FA for a user
   */
  async disable(userId: string, password: string): Promise<boolean> {
    const supabase = createClient();
    
    // Verify user's password first
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || user.id !== userId) {
      return false;
    }
    
    // Re-authenticate with password
    const { error } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password,
    });
    
    if (error) {
      await auditLogger.logSecurityEvent('auth_failure', {
        reason: '2fa_disable_invalid_password',
        userId,
      });
      return false;
    }
    
    // Disable 2FA
    const adminClient = createAdminClient();
    await adminClient
      .from('two_factor_secrets')
      .delete()
      .eq('user_id', userId);
      
    await auditLogger.log({
      action: '2fa_disabled',
      resourceType: 'auth',
      userId,
      status: 'success',
    });
    
    return true;
  }
  
  /**
   * Check if user has 2FA enabled
   */
  async isEnabled(userId: string): Promise<boolean> {
    const supabase = createAdminClient();
    const { data } = await supabase
      .from('two_factor_secrets')
      .select('enabled')
      .eq('user_id', userId)
      .single();
      
    return data?.enabled || false;
  }
  
  // Private methods
  
  private generateBase32Secret(length: number): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const random = randomBytes(length);
    let secret = '';
    
    for (let i = 0; i < random.length; i++) {
      secret += charset[random[i] % charset.length];
    }
    
    return secret;
  }
  
  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    
    for (let i = 0; i < BACKUP_CODES_COUNT; i++) {
      const code = randomBytes(4).toString('hex').toUpperCase();
      codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
    }
    
    return codes;
  }
  
  private hashBackupCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }
  
  private async verifyBackupCode(userId: string, code: string): Promise<boolean> {
    const supabase = createAdminClient();
    const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const hashedCode = this.hashBackupCode(normalizedCode);
    
    // Get backup codes
    const { data: tfaData } = await supabase
      .from('two_factor_secrets')
      .select('backup_codes, used_backup_codes')
      .eq('user_id', userId)
      .single();
      
    if (!tfaData) return false;
    
    const usedCodes = tfaData.used_backup_codes || [];
    
    // Check if code was already used
    if (usedCodes.includes(hashedCode)) {
      await auditLogger.logSecurityEvent('suspicious_activity', {
        reason: '2fa_backup_code_reuse',
        userId,
      });
      return false;
    }
    
    // Check if code is valid
    if (!tfaData.backup_codes.includes(hashedCode)) {
      return false;
    }
    
    // Mark code as used
    await supabase
      .from('two_factor_secrets')
      .update({
        used_backup_codes: [...usedCodes, hashedCode],
      })
      .eq('user_id', userId);
      
    await auditLogger.log({
      action: '2fa_backup_code_used',
      resourceType: 'auth',
      userId,
      metadata: { remainingCodes: tfaData.backup_codes.length - usedCodes.length - 1 },
      status: 'success',
    });
    
    return true;
  }
  
  private verifyTOTP(secret: string, token: string, counter?: number): boolean {
    const currentCounter = counter || this.getCurrentCounter();
    
    // Check within time window
    for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
      const testCounter = currentCounter + i;
      const expectedToken = this.generateTOTP(secret, testCounter);
      
      if (token === expectedToken) {
        return true;
      }
    }
    
    return false;
  }
  
  private generateTOTP(secret: string, counter: number): string {
    // Convert base32 secret to buffer
    const buffer = this.base32ToBuffer(secret);
    
    // Create counter buffer (8 bytes, big endian)
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(counter));
    
    // Generate HMAC using secret as key (RFC 4226/HOTP -> TOTP)
    const hmac = createHmac('sha1', buffer).update(counterBuffer).digest();
    
    // Dynamic truncation
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = (
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)
    ) % Math.pow(10, TOTP_DIGITS);
    
    return code.toString().padStart(TOTP_DIGITS, '0');
  }
  
  private getCurrentCounter(): number {
    return Math.floor(Date.now() / 1000 / TOTP_PERIOD);
  }
  
  private base32ToBuffer(secret: string): Buffer {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    
    for (const char of secret.toUpperCase()) {
      const index = charset.indexOf(char);
      if (index === -1) continue;
      bits += index.toString(2).padStart(5, '0');
    }
    
    const bytes: number[] = [];
    for (let i = 0; i < bits.length; i += 8) {
      if (i + 8 <= bits.length) {
        bytes.push(parseInt(bits.slice(i, i + 8), 2));
      }
    }
    
    return Buffer.from(bytes);
  }
  
  // Encryption methods using AES-256-GCM
  private async encryptSecret(secret: string): Promise<string> {
    const encryptionKey = process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!encryptionKey) {
      throw new Error('Encryption key not configured');
    }
    
    const { EncryptionService } = await import('@/lib/crypto/encryption');
    return EncryptionService.encrypt(secret, encryptionKey);
  }
  
  private async decryptSecret(encrypted: string): Promise<string> {
    const encryptionKey = process.env.ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!encryptionKey) {
      throw new Error('Encryption key not configured');
    }
    
    const { EncryptionService } = await import('@/lib/crypto/encryption');
    return EncryptionService.decrypt(encrypted, encryptionKey);
  }
}

// Session management
export class SessionManager {
  async createSession(
    userId: string,
    deviceInfo?: {
      userAgent?: string;
      ipAddress?: string;
      deviceId?: string;
    }
  ): Promise<string> {
    const supabase = createAdminClient();
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // 24 hour sessions
    
    await supabase.from('user_sessions').insert({
      id: sessionId,
      user_id: userId,
      device_id: deviceInfo?.deviceId,
      user_agent: deviceInfo?.userAgent,
      ip_address: deviceInfo?.ipAddress,
      expires_at: expiresAt.toISOString(),
      created_at: new Date().toISOString(),
    });
    
    return sessionId;
  }
  
  async validateSession(sessionId: string): Promise<{ valid: boolean; userId?: string }> {
    const supabase = createAdminClient();
    
    const { data: session } = await supabase
      .from('user_sessions')
      .select('user_id, expires_at')
      .eq('id', sessionId)
      .single();
      
    if (!session) {
      return { valid: false };
    }
    
    if (new Date(session.expires_at) < new Date()) {
      // Session expired
      await this.revokeSession(sessionId);
      return { valid: false };
    }
    
    // Update last activity
    await supabase
      .from('user_sessions')
      .update({ last_activity: new Date().toISOString() })
      .eq('id', sessionId);
      
    return { valid: true, userId: session.user_id };
  }
  
  async revokeSession(sessionId: string): Promise<void> {
    const supabase = createAdminClient();
    await supabase
      .from('user_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', sessionId);
  }
  
  async revokeSessions(userId: string): Promise<void> {
    const supabase = createAdminClient();
    await supabase
      .from('user_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('revoked_at', null);
  }
}

// Export singleton instances
export const twoFactorAuth = new TwoFactorAuth();
export const sessionManager = new SessionManager();
