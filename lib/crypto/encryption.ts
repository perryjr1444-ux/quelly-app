import crypto from 'crypto';

/**
 * Secure encryption utilities using AES-256-GCM
 */
export class EncryptionService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly IV_LENGTH = 16; // 128 bits
  private static readonly TAG_LENGTH = 16; // 128 bits
  private static readonly SALT_LENGTH = 32; // 256 bits
  
  /**
   * Derive encryption key from master key using PBKDF2
   */
  private static deriveKey(masterKey: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(masterKey, salt, 100000, this.KEY_LENGTH, 'sha256');
  }
  
  /**
   * Encrypt data using AES-256-GCM
   */
  static encrypt(plaintext: string, masterKey: string): string {
    // Generate random salt and IV
    const salt = crypto.randomBytes(this.SALT_LENGTH);
    const iv = crypto.randomBytes(this.IV_LENGTH);
    
    // Derive key from master key
    const key = this.deriveKey(masterKey, salt);
    
    // Create cipher
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);
    
    // Encrypt data
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);
    
    // Get auth tag
    const tag = cipher.getAuthTag();
    
    // Combine salt + iv + tag + encrypted data
    const combined = Buffer.concat([salt, iv, tag, encrypted]);
    
    // Return base64 encoded
    return combined.toString('base64');
  }
  
  /**
   * Decrypt data using AES-256-GCM
   */
  static decrypt(encryptedData: string, masterKey: string): string {
    // Decode from base64
    const combined = Buffer.from(encryptedData, 'base64');
    
    // Extract components
    const salt = combined.slice(0, this.SALT_LENGTH);
    const iv = combined.slice(this.SALT_LENGTH, this.SALT_LENGTH + this.IV_LENGTH);
    const tag = combined.slice(this.SALT_LENGTH + this.IV_LENGTH, this.SALT_LENGTH + this.IV_LENGTH + this.TAG_LENGTH);
    const encrypted = combined.slice(this.SALT_LENGTH + this.IV_LENGTH + this.TAG_LENGTH);
    
    // Derive key from master key
    const key = this.deriveKey(masterKey, salt);
    
    // Create decipher
    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    // Decrypt data
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  }
  
  /**
   * Generate cryptographically secure random string
   */
  static generateSecureRandom(length: number = 32): string {
    return crypto.randomBytes(length).toString('base64url');
  }
  
  /**
   * Hash data using SHA-256
   */
  static hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
  
  /**
   * Constant-time string comparison to prevent timing attacks
   */
  static secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
  
  /**
   * Generate HMAC signature
   */
  static hmac(data: string, key: string): string {
    return crypto.createHmac('sha256', key).update(data).digest('hex');
  }
}
