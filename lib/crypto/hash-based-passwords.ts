import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditLogger } from '@/lib/audit/logger';
import { EncryptionService } from '@/lib/crypto/encryption';
import { cache } from '@/lib/cache/redis';
import crypto from 'crypto';

/**
 * Hash-Based Password System
 * 
 * THE CORE REVOLUTIONARY CONCEPT:
 * - Passwords are generated using cryptographic hashes
 * - Each password is a hash of: base_secret + service + timestamp + nonce
 * - Automatic rotation changes the timestamp/nonce, making old hashes invalid
 * - Integrates with the handshake.py protocol for additional security
 */

interface HashPasswordConfig {
  baseSecret: string;
  service: string;
  timestamp: number;
  nonce: string;
  algorithm: 'sha256' | 'sha512' | 'blake2b';
  iterations: number;
}

interface HashPasswordResult {
  password: string;
  hash: string;
  config: HashPasswordConfig;
  expiresAt: Date;
}

interface HandshakeProof {
  type: string;
  proof: string;
  timestamp: number;
}

export class HashBasedPasswordService {
  private static readonly DEFAULT_ALGORITHM = 'sha256';
  private static readonly DEFAULT_ITERATIONS = 10000;
  private static readonly PASSWORD_LENGTH = 32;
  private static readonly HASH_LENGTH = 64;
  
  /**
   * THE CORE REVOLUTIONARY FEATURE: Generate hash-based password
   * This creates a password that's a cryptographic hash of multiple factors
   */
  static async generateHashPassword(
    userId: string,
    service: string,
    options: {
      algorithm?: 'sha256' | 'sha512' | 'blake2b';
      iterations?: number;
      customSecret?: string;
    } = {}
  ): Promise<HashPasswordResult> {
    const supabase = createAdminClient();
    
    try {
      // Get or create user's base secret
      const baseSecret = await this.getOrCreateBaseSecret(userId, options.customSecret);
      
      // Generate unique nonce for this password
      const nonce = EncryptionService.generateSecureRandom(16);
      
      // Current timestamp for uniqueness
      const timestamp = Date.now();
      
      // Create hash configuration
      const config: HashPasswordConfig = {
        baseSecret,
        service,
        timestamp,
        nonce,
        algorithm: options.algorithm || this.DEFAULT_ALGORITHM,
        iterations: options.iterations || this.DEFAULT_ITERATIONS
      };
      
      // Generate the hash-based password
      const password = await this.computeHashPassword(config);
      
      // Generate hash for storage (different from password)
      const hash = await this.computePasswordHash(password, config);
      
      // Calculate expiration (24 hours from now)
      const expiresAt = new Date(timestamp + (24 * 60 * 60 * 1000));
      
      // Store password reference with hash
      const { data: passwordRef, error } = await supabase
        .from('password_references')
        .insert({
          user_id: userId,
          label: `Hash-based password for ${service}`,
          service,
          status: 'active',
          expires_at: expiresAt.toISOString(),
          hash_config: config,
          password_hash: hash,
          created_at: new Date().toISOString(),
          hash_based: true
        })
        .select()
        .single();
        
      if (error) {
        throw new Error(`Failed to store password reference: ${error.message}`);
      }
      
      // Log password generation
      await auditLogger.log({
        action: 'hash_password_generated',
        resourceType: 'password',
        userId,
        metadata: {
          passwordId: passwordRef.id,
          service,
          algorithm: config.algorithm,
          iterations: config.iterations
        },
        status: 'success'
      });
      
      return {
        password,
        hash,
        config,
        expiresAt
      };
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId,
        service,
        error: error?.message
      });
      throw error;
    }
  }
  
  /**
   * THE REVOLUTIONARY FEATURE: Rotate hash-based password
   * This changes the timestamp/nonce, making the old hash invalid
   */
  static async rotateHashPassword(
    passwordId: string,
    service: string,
    reason: string = 'Auto-rotation after login'
  ): Promise<HashPasswordResult> {
    const supabase = createAdminClient();
    
    try {
      // Get current password configuration
      const { data: currentPassword, error } = await supabase
        .from('password_references')
        .select('*')
        .eq('id', passwordId)
        .single();
        
      if (error || !currentPassword) {
        throw new Error('Password not found');
      }
      
      if (!currentPassword.hash_based) {
        throw new Error('Password is not hash-based');
      }
      
      // Mark old password as rotated
      await supabase
        .from('password_references')
        .update({
          status: 'rotated',
          rotated_at: new Date().toISOString(),
          rotation_reason: reason
        })
        .eq('id', passwordId);
      
      // Generate new hash-based password with updated config
      const newConfig: HashPasswordConfig = {
        ...currentPassword.hash_config,
        timestamp: Date.now(), // New timestamp
        nonce: EncryptionService.generateSecureRandom(16) // New nonce
      };
      
      // Generate new password
      const newPassword = await this.computeHashPassword(newConfig);
      const newHash = await this.computePasswordHash(newPassword, newConfig);
      
      // Create new password reference
      const { data: newPasswordRef, error: newError } = await supabase
        .from('password_references')
        .insert({
          user_id: currentPassword.user_id,
          label: currentPassword.label,
          service,
          status: 'active',
          expires_at: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(),
          hash_config: newConfig,
          password_hash: newHash,
          created_at: new Date().toISOString(),
          hash_based: true,
          rotation_count: (currentPassword.rotation_count || 0) + 1
        })
        .select()
        .single();
        
      if (newError) {
        throw new Error(`Failed to create new password: ${newError.message}`);
      }
      
      // Log rotation
      await supabase
        .from('password_rotations')
        .insert({
          old_password_id: passwordId,
          new_password_id: newPasswordRef.id,
          user_id: currentPassword.user_id,
          service,
          reason,
          success: true,
          created_at: new Date().toISOString()
        });
      
      await auditLogger.log({
        action: 'hash_password_rotated',
        resourceType: 'password',
        userId: currentPassword.user_id,
        metadata: {
          oldPasswordId: passwordId,
          newPasswordId: newPasswordRef.id,
          service,
          reason
        },
        status: 'success'
      });
      
      return {
        password: newPassword,
        hash: newHash,
        config: newConfig,
        expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000))
      };
      
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
   * Verify hash-based password against stored hash
   */
  static async verifyHashPassword(
    passwordId: string,
    providedPassword: string
  ): Promise<{ valid: boolean; reason?: string }> {
    const supabase = createClient();
    
    try {
      // Get password configuration
      const { data: passwordRef, error } = await supabase
        .from('password_references')
        .select('*')
        .eq('id', passwordId)
        .single();
        
      if (error || !passwordRef) {
        return { valid: false, reason: 'Password not found' };
      }
      
      if (!passwordRef.hash_based) {
        return { valid: false, reason: 'Password is not hash-based' };
      }
      
      // Check if password is expired
      if (new Date(passwordRef.expires_at) < new Date()) {
        return { valid: false, reason: 'Password expired' };
      }
      
      // Check if password is rotated
      if (passwordRef.status === 'rotated') {
        return { valid: false, reason: 'Password has been rotated' };
      }
      
      // Recompute hash from provided password
      const computedHash = await this.computePasswordHash(providedPassword, passwordRef.hash_config);
      
      // Compare with stored hash
      const isValid = computedHash === passwordRef.password_hash;
      
      if (isValid) {
        // Log successful verification
      await auditLogger.log({
          action: 'hash_password_verified',
          resourceType: 'password',
          userId: passwordRef.user_id,
        metadata: { passwordId },
        status: 'success'
        });
      } else {
        // Log failed verification
        await auditLogger.logSecurityEvent('auth_failure', {
          passwordId,
          userId: passwordRef.user_id
        });
      }
      
      return { valid: isValid, reason: isValid ? undefined : 'Hash mismatch' };
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        passwordId,
        error: error?.message
      });
      return { valid: false, reason: 'Verification error' };
    }
  }
  
  /**
   * Compute hash-based password from configuration
   */
  private static async computeHashPassword(config: HashPasswordConfig): Promise<string> {
    const { baseSecret, service, timestamp, nonce, algorithm, iterations } = config;
    
    // Create input string
    const input = `${baseSecret}:${service}:${timestamp}:${nonce}`;
    
    // Apply PBKDF2 with specified algorithm
    const hash = crypto.pbkdf2Sync(
      input,
      `${service}:${timestamp}`, // salt
      iterations,
      this.PASSWORD_LENGTH,
      algorithm
    );
    
    // Convert to base64 and take first 32 characters
    return hash.toString('base64').substring(0, this.PASSWORD_LENGTH);
  }
  
  /**
   * Compute password hash for storage
   */
  private static async computePasswordHash(
    password: string,
    config: HashPasswordConfig
  ): Promise<string> {
    const { service, timestamp, algorithm } = config;
    
    // Use different salt for storage hash
    const salt = `${service}:${timestamp}:storage`;
    
    const hash = crypto.pbkdf2Sync(
      password,
      salt,
      this.DEFAULT_ITERATIONS,
      this.HASH_LENGTH,
      algorithm
    );
    
    return hash.toString('hex');
  }
  
  /**
   * Get or create user's base secret
   */
  private static async getOrCreateBaseSecret(
    userId: string,
    customSecret?: string
  ): Promise<string> {
    const supabase = createAdminClient();
    
    // Check if user already has a base secret
    const { data: existingSecret } = await supabase
      .from('user_secrets')
      .select('secret')
      .eq('user_id', userId)
      .eq('type', 'base_secret')
      .single();
    
    if (existingSecret) {
      return existingSecret.secret;
    }
    
    // Create new base secret
    const baseSecret = customSecret || EncryptionService.generateSecureRandom(64);
    
    await supabase
      .from('user_secrets')
      .insert({
        user_id: userId,
        type: 'base_secret',
        secret: baseSecret,
        created_at: new Date().toISOString()
      });
    
    return baseSecret;
  }
  
  /**
   * Integrate with handshake.py protocol
   */
  static async generateHandshakeProof(
    passwordId: string,
    artifacts: Array<{ type: string; collapsed: string }>
  ): Promise<HandshakeProof[]> {
    const proofs: HandshakeProof[] = [];
    const timestamp = Math.floor(Date.now() / 1000);
    
    for (const artifact of artifacts) {
      // Generate proof using the same method as handshake.py
      const proof = crypto
        .createHash('sha256')
        .update(artifact.collapsed + timestamp.toString())
        .digest('hex');
      
      proofs.push({
        type: artifact.type,
        proof,
        timestamp
      });
    }
    
    return proofs;
  }
  
  /**
   * Verify handshake proofs
   */
  static async verifyHandshakeProofs(
    passwordId: string,
    proofs: HandshakeProof[],
    expectedArtifacts: Array<{ type: string; collapsed: string }>
  ): Promise<{ valid: boolean; verifiedCount: number; requiredCount: number }> {
    const lookup = new Map(expectedArtifacts.map(a => [a.type, a]));
    let verifiedCount = 0;
    const requiredCount = Math.ceil(expectedArtifacts.length * 0.6); // 60% required
    
    for (const proof of proofs) {
      const artifact = lookup.get(proof.type);
      if (!artifact) continue;
      
      // Recompute proof
      const expectedProof = crypto
        .createHash('sha256')
        .update(artifact.collapsed + proof.timestamp.toString())
        .digest('hex');
      
      if (proof.proof === expectedProof) {
        verifiedCount++;
      }
    }
    
    return {
      valid: verifiedCount >= requiredCount,
      verifiedCount,
      requiredCount
    };
  }
  
  /**
   * Get hash-based password statistics
   */
  static async getHashPasswordStats(userId: string): Promise<{
    totalHashPasswords: number;
    activeHashPasswords: number;
    totalRotations: number;
    averageRotationTime: number;
    mostUsedAlgorithm: string;
  }> {
    const supabase = createClient();
    
    // Get all hash-based passwords
    const { data: passwords } = await supabase
      .from('password_references')
      .select('*')
      .eq('user_id', userId)
      .eq('hash_based', true);
    
    if (!passwords) {
      return {
        totalHashPasswords: 0,
        activeHashPasswords: 0,
        totalRotations: 0,
        averageRotationTime: 0,
        mostUsedAlgorithm: 'none'
      };
    }
    
    const activePasswords = passwords.filter(p => p.status === 'active');
    const totalRotations = passwords.reduce((sum, p) => sum + (p.rotation_count || 0), 0);
    
    // Calculate average rotation time
    const rotationTimes = passwords
      .filter(p => p.rotated_at)
      .map(p => new Date(p.rotated_at).getTime() - new Date(p.created_at).getTime());
    
    const averageRotationTime = rotationTimes.length > 0 
      ? rotationTimes.reduce((sum, time) => sum + time, 0) / rotationTimes.length 
      : 0;
    
    // Find most used algorithm
    const algorithmCounts = passwords.reduce((acc: Record<string, number>, p: any) => {
      const algo = p.hash_config?.algorithm || 'sha256';
      acc[algo] = (acc[algo] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const mostUsedAlgorithm = Object.entries(algorithmCounts)
      .sort(([,a], [,b]) => (b as number) - (a as number))[0]?.[0] || 'sha256';
    
    return {
      totalHashPasswords: passwords.length,
      activeHashPasswords: activePasswords.length,
      totalRotations,
      averageRotationTime: Math.round(averageRotationTime / (1000 * 60 * 60)), // hours
      mostUsedAlgorithm
    };
  }
}

// Export singleton
export const hashBasedPasswords = new HashBasedPasswordService();
