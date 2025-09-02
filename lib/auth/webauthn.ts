import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditLogger } from '@/lib/audit/logger';
import { EncryptionService } from '@/lib/crypto/encryption';

/**
 * WebAuthn / Biometric Authentication Service
 * 
 * Supports:
 * - Fingerprint authentication (Touch ID, Windows Hello)
 * - Face recognition (Face ID)
 * - Security keys (YubiKey, etc.)
 * - Platform authenticators
 */

interface WebAuthnCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransport[];
  deviceType: 'platform' | 'cross-platform';
  aaguid?: string;
  userVerified: boolean;
}

interface RegistrationOptions {
  userId: string;
  userName: string;
  userDisplayName: string;
  requireUserVerification?: boolean;
  preferPlatformAuthenticator?: boolean;
}

interface AuthenticationOptions {
  userId: string;
  requireUserVerification?: boolean;
}

export class WebAuthnService {
  private static readonly RP_NAME = 'PoofPass';
  private static readonly RP_ID = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost';
  private static readonly TIMEOUT = 60000; // 60 seconds
  private static readonly CHALLENGE_LENGTH = 32;
  
  /**
   * Generate registration options for WebAuthn
   */
  static async generateRegistrationOptions(
    options: RegistrationOptions
  ): Promise<PublicKeyCredentialCreationOptions> {
    const supabase = createAdminClient();
    
    // Generate challenge
    const challenge = EncryptionService.generateSecureRandom(this.CHALLENGE_LENGTH);
    
    // Store challenge for verification
    await supabase.from('webauthn_challenges').insert({
      user_id: options.userId,
      challenge,
      type: 'registration',
      expires_at: new Date(Date.now() + this.TIMEOUT).toISOString()
    });
    
    // Get existing credentials to exclude
    const { data: existingCredentials } = await supabase
      .from('webauthn_credentials')
      .select('credential_id')
      .eq('user_id', options.userId);
      
    const excludeCredentials = existingCredentials?.map(cred => ({
      id: Buffer.from(cred.credential_id, 'base64'),
      type: 'public-key' as PublicKeyCredentialType
    })) || [];
    
    return {
      challenge: Buffer.from(challenge, 'base64'),
      rp: {
        name: this.RP_NAME,
        id: this.RP_ID
      },
      user: {
        id: Buffer.from(options.userId),
        name: options.userName,
        displayName: options.userDisplayName
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },  // ES256 (preferred)
        { alg: -257, type: 'public-key' }, // RS256 (fallback)
      ],
      authenticatorSelection: {
        authenticatorAttachment: options.preferPlatformAuthenticator ? 'platform' : undefined,
        requireResidentKey: false,
        userVerification: options.requireUserVerification ? 'required' : 'preferred'
      },
      timeout: this.TIMEOUT,
      attestation: 'direct',
      excludeCredentials
    };
  }
  
  /**
   * Verify registration response
   */
  static async verifyRegistration(
    userId: string,
    credential: PublicKeyCredential,
    clientDataJSON: string,
    attestationObject: string
  ): Promise<{ verified: boolean; credentialId?: string }> {
    const supabase = createAdminClient();
    
    try {
      // Parse client data
      const clientData = JSON.parse(
        Buffer.from(clientDataJSON, 'base64').toString()
      );
      
      // Verify challenge
      const { data: challengeData } = await supabase
        .from('webauthn_challenges')
        .select('challenge')
        .eq('user_id', userId)
        .eq('type', 'registration')
        .gte('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
        
      if (!challengeData || clientData.challenge !== challengeData.challenge) {
        await auditLogger.logSecurityEvent('auth_failure', {
          reason: 'invalid_challenge',
          userId
        });
        return { verified: false };
      }
      
      // Verify origin
      const expectedOrigin = `https://${this.RP_ID}`;
      if (clientData.origin !== expectedOrigin && 
          clientData.origin !== `http://${this.RP_ID}` && // Allow http for localhost
          clientData.origin !== `http://${this.RP_ID}:3000`) {
        await auditLogger.logSecurityEvent('auth_failure', {
          reason: 'invalid_origin',
          userId,
          origin: clientData.origin
        });
        return { verified: false };
      }
      
      // Parse attestation object
      const attestation = this.parseAttestationObject(
        Buffer.from(attestationObject, 'base64')
      );
      
      // Extract public key and other data
      const credentialId = Buffer.from(credential.id).toString('base64');
      const publicKey = this.extractPublicKey(attestation.authData);
      
      // Determine device type
      const deviceType = this.determineDeviceType(attestation);
      
      // Store credential
      await supabase.from('webauthn_credentials').insert({
        user_id: userId,
        credential_id: credentialId,
        public_key: publicKey,
        counter: 0,
        device_type: deviceType,
        aaguid: attestation.aaguid,
        transports: (credential as any).response?.getTransports?.() || [],
        user_verified: attestation.userVerified,
        created_at: new Date().toISOString()
      });
      
      // Clean up used challenge
      await supabase
        .from('webauthn_challenges')
        .delete()
        .eq('user_id', userId)
        .eq('challenge', challengeData.challenge);
        
      await auditLogger.log({
        action: 'webauthn_registered',
        resourceType: 'auth',
        userId,
        metadata: {
          credentialId,
          deviceType
        },
        status: 'success'
      });
      
      return { verified: true, credentialId };
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId,
        error: error?.message
      });
      return { verified: false };
    }
  }
  
  /**
   * Generate authentication options
   */
  static async generateAuthenticationOptions(
    options: AuthenticationOptions
  ): Promise<PublicKeyCredentialRequestOptions> {
    const supabase = createAdminClient();
    
    // Generate challenge
    const challenge = EncryptionService.generateSecureRandom(this.CHALLENGE_LENGTH);
    
    // Store challenge for verification
    await supabase.from('webauthn_challenges').insert({
      user_id: options.userId,
      challenge,
      type: 'authentication',
      expires_at: new Date(Date.now() + this.TIMEOUT).toISOString()
    });
    
    // Get user's credentials
    const { data: credentials } = await supabase
      .from('webauthn_credentials')
      .select('credential_id, transports')
      .eq('user_id', options.userId);
      
    const allowCredentials = credentials?.map(cred => ({
      id: Buffer.from(cred.credential_id, 'base64'),
      type: 'public-key' as PublicKeyCredentialType,
      transports: cred.transports as AuthenticatorTransport[]
    })) || [];
    
    return {
      challenge: Buffer.from(challenge, 'base64'),
      timeout: this.TIMEOUT,
      rpId: this.RP_ID,
      allowCredentials,
      userVerification: options.requireUserVerification ? 'required' : 'preferred'
    };
  }
  
  /**
   * Verify authentication response
   */
  static async verifyAuthentication(
    userId: string,
    credentialId: string,
    clientDataJSON: string,
    authenticatorData: string,
    signature: string
  ): Promise<{ verified: boolean; requiresAdditionalAuth?: boolean }> {
    const supabase = createAdminClient();
    
    try {
      // Parse client data
      const clientData = JSON.parse(
        Buffer.from(clientDataJSON, 'base64').toString()
      );
      
      // Verify challenge
      const { data: challengeData } = await supabase
        .from('webauthn_challenges')
        .select('challenge')
        .eq('user_id', userId)
        .eq('type', 'authentication')
        .gte('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
        
      if (!challengeData || clientData.challenge !== challengeData.challenge) {
        await auditLogger.logSecurityEvent('auth_failure', {
          reason: 'invalid_challenge',
          userId
        });
        return { verified: false };
      }
      
      // Get stored credential
      const { data: storedCredential } = await supabase
        .from('webauthn_credentials')
        .select('*')
        .eq('user_id', userId)
        .eq('credential_id', credentialId)
        .single();
        
      if (!storedCredential) {
        await auditLogger.logSecurityEvent('auth_failure', {
          reason: 'credential_not_found',
          userId,
          credentialId
        });
        return { verified: false };
      }
      
      // Parse authenticator data
      const authData = this.parseAuthenticatorData(
        Buffer.from(authenticatorData, 'base64')
      );
      
      // Verify counter (prevent replay attacks)
      if (authData.counter <= storedCredential.counter) {
        await auditLogger.logSecurityEvent('suspicious_activity', {
          userId,
          credentialId,
          storedCounter: storedCredential.counter,
          receivedCounter: authData.counter
        });
        
        // Disable the credential as it may be compromised
        await supabase
          .from('webauthn_credentials')
          .update({ disabled: true })
          .eq('credential_id', credentialId);
          
        return { verified: false };
      }
      
      // Verify signature
      const verified = await this.verifySignature(
        storedCredential.public_key,
        authenticatorData,
        clientDataJSON,
        signature
      );
      
      if (!verified) {
        await auditLogger.logSecurityEvent('auth_failure', {
          reason: 'invalid_signature',
          userId,
          credentialId
        });
        return { verified: false };
      }
      
      // Update counter
      await supabase
        .from('webauthn_credentials')
        .update({ 
          counter: authData.counter,
          last_used: new Date().toISOString()
        })
        .eq('credential_id', credentialId);
        
      // Clean up used challenge
      await supabase
        .from('webauthn_challenges')
        .delete()
        .eq('user_id', userId)
        .eq('challenge', challengeData.challenge);
        
      // Check if additional auth is required based on risk
      const requiresAdditionalAuth = await this.assessRisk(
        userId,
        storedCredential,
        authData
      );
      
      await auditLogger.log({
        action: 'webauthn_authenticated',
        resourceType: 'auth',
        userId,
        metadata: {
          credentialId,
          userVerified: authData.userVerified,
          requiresAdditionalAuth
        },
        status: 'success'
      });
      
      return { verified: true, requiresAdditionalAuth };
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId,
        error: error?.message
      });
      return { verified: false };
    }
  }
  
  /**
   * List user's WebAuthn credentials
   */
  static async listCredentials(userId: string): Promise<Array<{
    id: string;
    deviceType: string;
    lastUsed?: string;
    created: string;
  }>> {
    const supabase = createClient();
    
    const { data: credentials } = await supabase
      .from('webauthn_credentials')
      .select('credential_id, device_type, last_used, created_at')
      .eq('user_id', userId)
      .eq('disabled', false)
      .order('created_at', { ascending: false });
      
    return credentials?.map(cred => ({
      id: cred.credential_id,
      deviceType: cred.device_type,
      lastUsed: cred.last_used,
      created: cred.created_at
    })) || [];
  }
  
  /**
   * Remove a WebAuthn credential
   */
  static async removeCredential(userId: string, credentialId: string): Promise<boolean> {
    const supabase = createClient();
    
    const { error } = await supabase
      .from('webauthn_credentials')
      .delete()
      .eq('user_id', userId)
      .eq('credential_id', credentialId);
      
    if (!error) {
    await auditLogger.log({
        action: 'webauthn_removed',
        resourceType: 'auth',
        userId,
      metadata: { credentialId },
      status: 'success'
      });
    }
    
    return !error;
  }
  
  /**
   * Parse attestation object (simplified)
   */
  private static parseAttestationObject(buffer: Buffer): any {
    // This would use a CBOR parser in production
    // Simplified for demonstration
    return {
      authData: buffer.slice(0, 37),
      aaguid: buffer.slice(37, 53).toString('hex'),
      userVerified: (buffer[32] & 0x04) !== 0
    };
  }
  
  /**
   * Parse authenticator data
   */
  private static parseAuthenticatorData(buffer: Buffer): any {
    return {
      rpIdHash: buffer.slice(0, 32),
      flags: buffer[32],
      userPresent: (buffer[32] & 0x01) !== 0,
      userVerified: (buffer[32] & 0x04) !== 0,
      counter: buffer.readUInt32BE(33)
    };
  }
  
  /**
   * Extract public key from auth data (simplified)
   */
  private static extractPublicKey(authData: Buffer): string {
    // This would properly parse the COSE key in production
    // Simplified for demonstration
    return authData.toString('base64');
  }
  
  /**
   * Determine device type
   */
  private static determineDeviceType(attestation: any): 'platform' | 'cross-platform' {
    // Check AAGUID against known platform authenticators
    const platformAuthenticators = [
      'd548826e-79b4-db40-a3d8-11116f7e8349', // Windows Hello
      'adce0002-35bc-c60a-648b-0b25f1f05503', // Chrome Touch ID
      // Add more known platform authenticator AAGUIDs
    ];
    
    if (platformAuthenticators.includes(attestation.aaguid)) {
      return 'platform';
    }
    
    return 'cross-platform';
  }
  
  /**
   * Verify signature (simplified)
   */
  private static async verifySignature(
    publicKey: string,
    authenticatorData: string,
    clientDataJSON: string,
    signature: string
  ): Promise<boolean> {
    // This would use WebCrypto API to verify the signature
    // Simplified for demonstration
    return true;
  }
  
  /**
   * Assess risk and determine if additional auth is needed
   */
  private static async assessRisk(
    userId: string,
    credential: any,
    authData: any
  ): Promise<boolean> {
    // High-value operations might require user verification
    if (!authData.userVerified) {
      return true;
    }
    
    // New device or long time since last use
    if (!credential.last_used || 
        Date.now() - new Date(credential.last_used).getTime() > 30 * 24 * 60 * 60 * 1000) {
      return true;
    }
    
    return false;
  }
}

// Export singleton
export const webAuthn = new WebAuthnService();
