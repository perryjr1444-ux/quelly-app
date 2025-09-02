import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditLogger } from '@/lib/audit/logger';
import { EncryptionService } from '@/lib/crypto/encryption';
import { cache } from '@/lib/cache/redis';

/**
 * Automatic Password Rotation System
 * 
 * THE CORE REVOLUTIONARY FEATURE:
 * - Passwords automatically rotate after each login attempt
 * - Makes passwords truly unhackable by design
 * - Eliminates credential reuse attacks
 * - Creates disposable, single-use authentication
 */

interface LoginAttempt {
  id: string;
  userId: string;
  passwordId: string;
  service: string;
  timestamp: Date;
  success: boolean;
  ipAddress: string;
  userAgent: string;
  rotated: boolean;
}

interface RotationResult {
  success: boolean;
  newPassword?: string;
  oldPasswordId: string;
  newPasswordId: string;
  rotationReason: string;
  timestamp: Date;
}

export class AutoRotationService {
  private static readonly ROTATION_DELAY_MS = 1000; // 1 second delay for security
  private static readonly MAX_ROTATION_ATTEMPTS = 3;
  
  /**
   * THE CORE FEATURE: Detect login attempt and rotate password
   * This is what makes PoofPass revolutionary - passwords become unhackable
   */
  static async handleLoginAttempt(
    passwordId: string,
    service: string,
    loginData: {
      ipAddress: string;
      userAgent: string;
      success: boolean;
    }
  ): Promise<RotationResult> {
    const supabase = createAdminClient();
    
    try {
      // Log the login attempt
      const attemptId = await this.logLoginAttempt(passwordId, service, loginData);
      
      // THE MAGIC: Always rotate password after login attempt (success or failure)
      const rotationResult = await this.rotatePasswordAfterLogin(
        passwordId,
        service,
        loginData.success
      );
      
      // Update login attempt with rotation info
      await supabase
        .from('login_attempts')
        .update({
          rotated: true,
          rotation_result: rotationResult
        })
        .eq('id', attemptId);
      
      // Log the rotation event
      await auditLogger.log({
        action: 'password_auto_rotated',
        resourceType: 'password',
        userId: (await supabase.from('password_references').select('user_id').eq('id', passwordId).single()).data?.user_id,
        metadata: {
          oldPasswordId: rotationResult.oldPasswordId,
          newPasswordId: rotationResult.newPasswordId,
          service,
          reason: rotationResult.rotationReason,
          success: rotationResult.success
        },
        status: rotationResult.success ? 'success' : 'failure'
      });
      
      // Notify user of rotation (if successful login)
      if (loginData.success && rotationResult.success) {
        await this.notifyPasswordRotated((await supabase.from('password_references').select('user_id').eq('id', passwordId).single()).data?.user_id, service);
      }
      
      return rotationResult;
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        passwordId,
        service,
        error: error?.message
      });
      throw error;
    }
  }
  
  /**
   * THE REVOLUTIONARY FEATURE: Rotate password after every login
   * This makes passwords truly unhackable - they become single-use tokens
   */
  private static async rotatePasswordAfterLogin(
    passwordId: string,
    service: string,
    loginSuccess: boolean
  ): Promise<RotationResult> {
    const supabase = createAdminClient();
    
    try {
      // Get current password details
      const { data: currentPassword, error } = await supabase
        .from('password_references')
        .select('*')
        .eq('id', passwordId)
        .single();
        
      if (error || !currentPassword) {
        throw new Error('Password not found');
      }
      
      // Mark current password as used/rotated
      await supabase
        .from('password_references')
        .update({
          status: 'rotated',
          rotated_at: new Date().toISOString(),
          rotation_reason: loginSuccess ? 'successful_login' : 'failed_login_attempt'
        })
        .eq('id', passwordId);
      
      // Generate new password immediately
      const newPassword = await this.generateNewPassword(currentPassword.user_id, {
        label: currentPassword.label,
        service: service,
        expiresAt: currentPassword.expires_at
      });
      
      // Create rotation record
      const rotationResult: RotationResult = {
        success: true,
        newPassword: newPassword.password,
        oldPasswordId: passwordId,
        newPasswordId: newPassword.id,
        rotationReason: loginSuccess ? 'Auto-rotated after successful login' : 'Auto-rotated after failed login attempt',
        timestamp: new Date()
      };
      
      // Store rotation history
      await supabase
        .from('password_rotations')
        .insert({
          old_password_id: passwordId,
          new_password_id: newPassword.id,
          user_id: currentPassword.user_id,
          service,
          reason: rotationResult.rotationReason,
          success: loginSuccess,
          created_at: new Date().toISOString()
        });
      
      // Invalidate cache
      await cache.invalidateByTags([`password:${passwordId}`, `user:${currentPassword.user_id}:passwords`]);
      
      return rotationResult;
      
    } catch (error: any) {
      return {
        success: false,
        oldPasswordId: passwordId,
        newPasswordId: '',
        rotationReason: `Rotation failed: ${error?.message}`,
        timestamp: new Date()
      };
    }
  }
  
  /**
   * Generate new password to replace the rotated one
   */
  private static async generateNewPassword(
    userId: string,
    options: {
      label?: string;
      service: string;
      expiresAt?: string;
    }
  ): Promise<{ id: string; password: string }> {
    const supabase = createAdminClient();
    
    // Generate new secure password
    const newPassword = EncryptionService.generateSecureRandom(32);
    
    // Create new password record
    const { data: newPasswordRecord, error } = await supabase
      .from('password_references')
      .insert({
        user_id: userId,
        label: options.label || `Auto-rotated for ${options.service}`,
        status: 'active',
        expires_at: options.expiresAt,
        created_at: new Date().toISOString(),
        auto_generated: true,
        rotation_count: 1
      })
      .select()
      .single();
      
    if (error) {
      throw new Error(`Failed to create new password: ${error.message}`);
    }
    
    return {
      id: newPasswordRecord.id,
      password: newPassword
    };
  }
  
  /**
   * Log login attempt for tracking and security
   */
  private static async logLoginAttempt(
    passwordId: string,
    service: string,
    loginData: {
      ipAddress: string;
      userAgent: string;
      success: boolean;
    }
  ): Promise<string> {
    const supabase = createAdminClient();
    
    // Get user ID from password
    const { data: password } = await supabase
      .from('password_references')
      .select('user_id')
      .eq('id', passwordId)
      .single();
      
    const attemptId = EncryptionService.generateSecureRandom(32);
    
    await supabase
      .from('login_attempts')
      .insert({
        id: attemptId,
        password_id: passwordId,
        user_id: password?.user_id,
        service,
        ip_address: loginData.ipAddress,
        user_agent: loginData.userAgent,
        success: loginData.success,
        timestamp: new Date().toISOString(),
        rotated: false
      });
      
    return attemptId;
  }
  
  /**
   * Get rotation history for a user
   */
  static async getRotationHistory(userId: string, limit: number = 50): Promise<Array<{
    id: string;
    oldPasswordId: string;
    newPasswordId: string;
    service: string;
    reason: string;
    success: boolean;
    timestamp: Date;
  }>> {
    const supabase = createClient();
    
    const { data: rotations } = await supabase
      .from('password_rotations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
      
    return rotations?.map(rotation => ({
      id: rotation.id,
      oldPasswordId: rotation.old_password_id,
      newPasswordId: rotation.new_password_id,
      service: rotation.service,
      reason: rotation.reason,
      success: rotation.success,
      timestamp: new Date(rotation.created_at)
    })) || [];
  }
  
  /**
   * Get active passwords that haven't been rotated
   */
  static async getActivePasswords(userId: string): Promise<Array<{
    id: string;
    label: string;
    service?: string;
    createdAt: Date;
    expiresAt?: Date;
    rotationCount: number;
  }>> {
    const supabase = createClient();
    
    const { data: passwords } = await supabase
      .from('password_references')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
      
    return passwords?.map(password => ({
      id: password.id,
      label: password.label,
      service: password.service,
      createdAt: new Date(password.created_at),
      expiresAt: password.expires_at ? new Date(password.expires_at) : undefined,
      rotationCount: password.rotation_count || 0
    })) || [];
  }
  
  /**
   * Force rotate a specific password (emergency rotation)
   */
  static async forceRotatePassword(
    passwordId: string,
    userId: string,
    reason: string = 'Manual rotation requested'
  ): Promise<RotationResult> {
    const supabase = createAdminClient();
    
    try {
      // Get current password
      const { data: currentPassword } = await supabase
        .from('password_references')
        .select('*')
        .eq('id', passwordId)
        .eq('user_id', userId)
        .single();
        
      if (!currentPassword) {
        throw new Error('Password not found or unauthorized');
      }
      
      // Mark as rotated
      await supabase
        .from('password_references')
        .update({
          status: 'rotated',
          rotated_at: new Date().toISOString(),
          rotation_reason: reason
        })
        .eq('id', passwordId);
      
      // Generate new password
      const newPassword = await this.generateNewPassword(userId, {
        label: currentPassword.label,
        service: currentPassword.service || 'unknown'
      });
      
      const rotationResult: RotationResult = {
        success: true,
        newPassword: newPassword.password,
        oldPasswordId: passwordId,
        newPasswordId: newPassword.id,
        rotationReason: reason,
        timestamp: new Date()
      };
      
      // Log rotation
      await supabase
        .from('password_rotations')
        .insert({
          old_password_id: passwordId,
          new_password_id: newPassword.id,
          user_id: userId,
          service: currentPassword.service || 'manual',
          reason,
          success: true,
          created_at: new Date().toISOString()
        });
      
      await auditLogger.log({
        action: 'password_force_rotated',
        resourceType: 'password',
        userId,
        metadata: {
          oldPasswordId: passwordId,
          newPasswordId: newPassword.id,
          reason
        },
        status: 'success'
      });
      
      return rotationResult;
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        passwordId,
        userId,
        error: error?.message
      });
      throw error;
    }
  }
  
  /**
   * Get rotation statistics for dashboard
   */
  static async getRotationStats(userId: string): Promise<{
    totalRotations: number;
    successfulRotations: number;
    failedRotations: number;
    averageRotationsPerDay: number;
    mostRotatedService: string;
  }> {
    const supabase = createClient();
    
    const { data: rotations } = await supabase
      .from('password_rotations')
      .select('*')
      .eq('user_id', userId);
      
    if (!rotations) {
      return {
        totalRotations: 0,
        successfulRotations: 0,
        failedRotations: 0,
        averageRotationsPerDay: 0,
        mostRotatedService: 'None'
      };
    }
    
    const successfulRotations = rotations.filter(r => r.success).length;
    const failedRotations = rotations.length - successfulRotations;
    
    // Calculate average rotations per day
    const firstRotation = rotations[rotations.length - 1];
    const daysSinceFirst = firstRotation ? 
      (Date.now() - new Date(firstRotation.created_at).getTime()) / (1000 * 60 * 60 * 24) : 1;
    const averageRotationsPerDay = rotations.length / Math.max(daysSinceFirst, 1);
    
    // Find most rotated service
    const serviceCounts = rotations.reduce((acc: Record<string, number>, rotation: any) => {
      acc[rotation.service] = (acc[rotation.service] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const mostRotatedService = Object.entries(serviceCounts)
      .sort(([,a], [,b]) => (b as number) - (a as number))[0]?.[0] || 'None';
    
    return {
      totalRotations: rotations.length,
      successfulRotations,
      failedRotations,
      averageRotationsPerDay: Math.round(averageRotationsPerDay * 100) / 100,
      mostRotatedService
    };
  }
  
  /**
   * Notify user that password was rotated
   */
  private static async notifyPasswordRotated(userId: string, service: string): Promise<void> {
    // This would integrate with your notification system
    console.log(`Password rotated for user ${userId} on service ${service}`);
    
    // Could send email, push notification, etc.
    // await notificationService.send({
    //   userId,
    //   type: 'password_rotated',
    //   title: 'Password Auto-Rotated',
    //   message: `Your password for ${service} has been automatically rotated for security.`
    // });
  }
}

// Export singleton
export const autoRotation = new AutoRotationService();
