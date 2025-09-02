import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditLogger } from '@/lib/audit/logger';
import { EncryptionService } from '@/lib/crypto/encryption';
import { ZeroKnowledgeService } from '@/lib/crypto/zero-knowledge';
import { cache } from '@/lib/cache/redis';

/**
 * Secure Password Sharing Service
 * 
 * Features:
 * - End-to-end encrypted sharing
 * - Time-limited access
 * - Usage tracking and revocation
 * - Granular permissions
 * - Audit trail
 * - Zero-knowledge architecture
 */

interface ShareOptions {
  passwordId: string;
  recipientEmail: string;
  permissions: {
    canView: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canShare: boolean;
  };
  expiresAt?: Date;
  maxUses?: number;
  requireApproval?: boolean;
  message?: string;
}

interface ShareInvitation {
  id: string;
  passwordId: string;
  senderId: string;
  recipientEmail: string;
  permissions: ShareOptions['permissions'];
  expiresAt: Date;
  maxUses: number;
  usedCount: number;
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  encryptedData: string;
  publicKey: string;
  createdAt: Date;
  acceptedAt?: Date;
}

export class PasswordSharingService {
  private static readonly SHARE_EXPIRY_DEFAULT = 7 * 24 * 60 * 60 * 1000; // 7 days
  private static readonly MAX_SHARES_PER_PASSWORD = 10;
  
  /**
   * Create a secure password share
   */
  static async createShare(
    senderId: string,
    options: ShareOptions
  ): Promise<{
    shareId: string;
    shareUrl: string;
    qrCode?: string;
  }> {
    const supabase = createAdminClient();
    
    try {
      // Validate sender permissions
      const canShare = await this.canUserSharePassword(senderId, options.passwordId);
      if (!canShare) {
        throw new Error('Insufficient permissions to share this password');
      }
      
      // Check share limits
      const shareCount = await this.getActiveShareCount(options.passwordId);
      if (shareCount >= this.MAX_SHARES_PER_PASSWORD) {
        throw new Error('Maximum number of shares reached for this password');
      }
      
      // Get password data
      const passwordData = await this.getPasswordData(options.passwordId);
      if (!passwordData) {
        throw new Error('Password not found');
      }
      
      // Generate sharing key pair
      const { publicKey, privateKey } = ZeroKnowledgeService.generateSharingKey();
      
      // Encrypt password data for sharing
      const encryptedData = await this.encryptForSharing(
        passwordData,
        publicKey,
        privateKey
      );
      
      // Create share invitation
      const shareId = EncryptionService.generateSecureRandom(32);
      const expiresAt = options.expiresAt || new Date(Date.now() + this.SHARE_EXPIRY_DEFAULT);
      
      const { data: share, error } = await supabase
        .from('password_shares')
        .insert({
          id: shareId,
          password_id: options.passwordId,
          sender_id: senderId,
          recipient_email: options.recipientEmail,
          permissions: options.permissions,
          expires_at: expiresAt.toISOString(),
          max_uses: options.maxUses || 1,
          used_count: 0,
          status: 'pending',
          encrypted_data: encryptedData.encrypted,
          ephemeral_public_key: encryptedData.ephemeralPublicKey,
          sender_public_key: publicKey,
          message: options.message,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
        
      if (error) {
        throw new Error(`Failed to create share: ${error.message}`);
      }
      
      // Generate share URL
      const shareUrl = `${process.env.NEXT_PUBLIC_APP_URL}/share/${shareId}`;
      
      // Generate QR code for easy sharing
      const qrCode = await this.generateQRCode(shareUrl);
      
      // Send notification to recipient
      await this.sendShareNotification(options.recipientEmail, {
        senderId,
        shareId,
        message: options.message,
        expiresAt,
      });
      
      // Log share creation
      await auditLogger.log({
        action: 'password_shared',
        resourceType: 'password',
        userId: senderId,
        metadata: {
          passwordId: options.passwordId,
          recipientEmail: options.recipientEmail,
          shareId,
          permissions: options.permissions,
        },
        status: 'success'
      });
      
      // Invalidate cache
      await cache.invalidateByTags([`password:${options.passwordId}:shares`]);
      
      return {
        shareId,
        shareUrl,
        qrCode,
      };
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId: senderId,
        passwordId: options.passwordId,
        error: error?.message,
      });
      throw error;
    }
  }
  
  /**
   * Accept a password share
   */
  static async acceptShare(
    shareId: string,
    recipientId: string,
    recipientPrivateKey: string
  ): Promise<{
    passwordId: string;
    permissions: ShareOptions['permissions'];
  }> {
    const supabase = createAdminClient();
    
    try {
      // Get share details
      const { data: share, error } = await supabase
        .from('password_shares')
        .select('*')
        .eq('id', shareId)
        .single();
        
      if (error || !share) {
        throw new Error('Share not found');
      }
      
      // Validate share
      if (share.status !== 'pending') {
        throw new Error('Share is no longer available');
      }
      
      if (new Date(share.expires_at) < new Date()) {
        throw new Error('Share has expired');
      }
      
      if (share.used_count >= share.max_uses) {
        throw new Error('Share usage limit exceeded');
      }
      
      // Decrypt shared data
      const passwordData = await this.decryptSharedData(
        share.encrypted_data,
        share.ephemeral_public_key,
        recipientPrivateKey
      );
      
      // Create password for recipient
      const newPasswordId = await this.createPasswordForRecipient(
        recipientId,
        passwordData,
        share.password_id,
        share.sender_id
      );
      
      // Update share status
      await supabase
        .from('password_shares')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString(),
          used_count: share.used_count + 1,
          recipient_id: recipientId,
        })
        .eq('id', shareId);
      
      // Create access record
      await supabase
        .from('password_access')
        .insert({
          password_id: newPasswordId,
          user_id: recipientId,
          shared_by: share.sender_id,
          permissions: share.permissions,
          created_at: new Date().toISOString(),
        });
      
      // Log acceptance
      await auditLogger.log({
        action: 'share_accepted',
        resourceType: 'password',
        userId: recipientId,
        metadata: {
          shareId,
          originalPasswordId: share.password_id,
          newPasswordId,
          senderId: share.sender_id,
        },
        status: 'success'
      });
      
      // Notify sender
      await this.notifyShareAccepted(share.sender_id, {
        shareId,
        recipientId,
        passwordId: share.password_id,
      });
      
      return {
        passwordId: newPasswordId,
        permissions: share.permissions,
      };
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId: recipientId,
        shareId,
        error: error?.message,
      });
      throw error;
    }
  }
  
  /**
   * Revoke a password share
   */
  static async revokeShare(
    shareId: string,
    userId: string
  ): Promise<void> {
    const supabase = createAdminClient();
    
    try {
      // Verify user can revoke this share
      const { data: share } = await supabase
        .from('password_shares')
        .select('*')
        .eq('id', shareId)
        .single();
        
      if (!share) {
        throw new Error('Share not found');
      }
      
      if (share.sender_id !== userId) {
        throw new Error('Unauthorized to revoke this share');
      }
      
      // Update share status
      await supabase
        .from('password_shares')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
        })
        .eq('id', shareId);
      
      // Revoke access for all recipients
      await supabase
        .from('password_access')
        .update({
          revoked: true,
          revoked_at: new Date().toISOString(),
        })
        .eq('shared_by', userId)
        .eq('password_id', share.password_id);
      
      // Log revocation
      await auditLogger.log({
        action: 'share_revoked',
        resourceType: 'password',
        userId,
        metadata: { shareId, passwordId: share.password_id },
        status: 'success'
      });
      
      // Notify recipients
      await this.notifyShareRevoked(shareId, share.password_id);
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId,
        shareId,
        error: error?.message,
      });
      throw error;
    }
  }
  
  /**
   * Get shared passwords for a user
   */
  static async getSharedPasswords(userId: string): Promise<Array<{
    id: string;
    title: string;
    sharedBy: string;
    permissions: ShareOptions['permissions'];
    sharedAt: Date;
    lastAccessed?: Date;
  }>> {
    const supabase = createClient();
    
    const { data: access } = await supabase
      .from('password_access')
      .select(`
        *,
        password:password_id (
          id,
          title,
          created_at
        ),
        shared_by_user:shared_by (
          email
        )
      `)
      .eq('user_id', userId)
      .eq('revoked', false)
      .order('created_at', { ascending: false });
      
    return access?.map(acc => ({
      id: acc.password_id,
      title: acc.password.title,
      sharedBy: acc.shared_by_user.email,
      permissions: acc.permissions,
      sharedAt: new Date(acc.created_at),
      lastAccessed: acc.last_accessed ? new Date(acc.last_accessed) : undefined,
    })) || [];
  }
  
  /**
   * Get share history for a password
   */
  static async getShareHistory(
    passwordId: string,
    userId: string
  ): Promise<Array<{
    id: string;
    recipientEmail: string;
    status: string;
    createdAt: Date;
    acceptedAt?: Date;
    expiresAt: Date;
    usedCount: number;
    maxUses: number;
  }>> {
    const supabase = createClient();
    
    // Verify user owns this password
    const canView = await this.canUserSharePassword(userId, passwordId);
    if (!canView) {
      throw new Error('Unauthorized to view share history');
    }
    
    const { data: shares } = await supabase
      .from('password_shares')
      .select('*')
      .eq('password_id', passwordId)
      .eq('sender_id', userId)
      .order('created_at', { ascending: false });
      
    return shares?.map(share => ({
      id: share.id,
      recipientEmail: share.recipient_email,
      status: share.status,
      createdAt: new Date(share.created_at),
      acceptedAt: share.accepted_at ? new Date(share.accepted_at) : undefined,
      expiresAt: new Date(share.expires_at),
      usedCount: share.used_count,
      maxUses: share.max_uses,
    })) || [];
  }
  
  /**
   * Update share permissions
   */
  static async updateSharePermissions(
    shareId: string,
    userId: string,
    permissions: ShareOptions['permissions']
  ): Promise<void> {
    const supabase = createAdminClient();
    
    try {
      // Verify user can update this share
      const { data: share } = await supabase
        .from('password_shares')
        .select('*')
        .eq('id', shareId)
        .single();
        
      if (!share || share.sender_id !== userId) {
        throw new Error('Unauthorized to update this share');
      }
      
      if (share.status !== 'pending') {
        throw new Error('Cannot update accepted or expired shares');
      }
      
      // Update permissions
      await supabase
        .from('password_shares')
        .update({ permissions })
        .eq('id', shareId);
      
      // Update access records
      await supabase
        .from('password_access')
        .update({ permissions })
        .eq('shared_by', userId)
        .eq('password_id', share.password_id);
      
      // Log update
      await auditLogger.log({
        action: 'share_permissions_updated',
        resourceType: 'password',
        userId,
        metadata: { shareId, permissions },
        status: 'success'
      });
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId,
        shareId,
        error: error?.message,
      });
      throw error;
    }
  }
  
  /**
   * Clean up expired shares
   */
  static async cleanupExpiredShares(): Promise<void> {
    const supabase = createAdminClient();
    
    const { data: expiredShares } = await supabase
      .from('password_shares')
      .select('id')
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString());
      
    if (expiredShares && expiredShares.length > 0) {
      await supabase
        .from('password_shares')
        .update({ status: 'expired' })
        .in('id', expiredShares.map(s => s.id));
        
      console.log(`Cleaned up ${expiredShares.length} expired shares`);
    }
  }
  
  /**
   * Helper methods
   */
  private static async canUserSharePassword(userId: string, passwordId: string): Promise<boolean> {
    const supabase = createClient();
    
    const { data: password } = await supabase
      .from('password_references')
      .select('user_id')
      .eq('id', passwordId)
      .single();
      
    return password?.user_id === userId;
  }
  
  private static async getActiveShareCount(passwordId: string): Promise<number> {
    const supabase = createClient();
    
    const { count } = await supabase
      .from('password_shares')
      .select('*', { count: 'exact', head: true })
      .eq('password_id', passwordId)
      .eq('status', 'pending');
      
    return count || 0;
  }
  
  private static async getPasswordData(passwordId: string): Promise<any> {
    // This would fetch the actual password data
    // Implementation depends on your vault system
    return { id: passwordId, title: 'Shared Password' };
  }
  
  private static async encryptForSharing(
    data: any,
    publicKey: string,
    privateKey: string
  ): Promise<{ encrypted: string; ephemeralPublicKey: string }> {
    return ZeroKnowledgeService.encryptForSharing(data, publicKey, privateKey);
  }
  
  private static async decryptSharedData(
    encryptedData: string,
    ephemeralPublicKey: string,
    privateKey: string
  ): Promise<any> {
    // Implementation would decrypt the shared data
    return { decrypted: true };
  }
  
  private static async createPasswordForRecipient(
    recipientId: string,
    passwordData: any,
    originalPasswordId: string,
    senderId: string
  ): Promise<string> {
    // Create a new password entry for the recipient
    // This would integrate with your vault system
    return EncryptionService.generateSecureRandom(32);
  }
  
  private static async generateQRCode(data: string): Promise<string> {
    // Generate QR code for share URL
    const QRCode = await import('qrcode');
    return QRCode.toDataURL(data);
  }
  
  private static async sendShareNotification(
    email: string,
    data: any
  ): Promise<void> {
    // Send email notification about the share
    // Implementation depends on your email service
    console.log(`Sending share notification to ${email}`);
  }
  
  private static async notifyShareAccepted(
    senderId: string,
    data: any
  ): Promise<void> {
    // Notify sender that share was accepted
    console.log(`Notifying sender ${senderId} of share acceptance`);
  }
  
  private static async notifyShareRevoked(
    shareId: string,
    passwordId: string
  ): Promise<void> {
    // Notify recipients that share was revoked
    console.log(`Notifying recipients of share revocation`);
  }
}

// Export singleton
export const passwordSharing = new PasswordSharingService();
