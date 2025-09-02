import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { auditLogger } from '@/lib/audit/logger';
import { cache } from '@/lib/cache/redis';
import { EncryptionService } from '@/lib/crypto/encryption';

/**
 * Team & Organization Management Service
 * 
 * Features:
 * - Multi-tenant organization structure
 * - Role-based access control (RBAC)
 * - Team invitations and management
 * - Shared password vaults
 * - Audit trails for all team actions
 * - Billing and subscription management
 */

interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  plan: 'free' | 'pro' | 'enterprise';
  settings: {
    allowGuestAccess: boolean;
    require2FA: boolean;
    passwordPolicy: {
      minLength: number;
      requireUppercase: boolean;
      requireLowercase: boolean;
      requireNumbers: boolean;
      requireSymbols: boolean;
    };
    sessionTimeout: number;
    maxMembers: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

interface TeamMember {
  id: string;
  organizationId: string;
  userId: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer' | 'guest';
  status: 'active' | 'pending' | 'suspended' | 'invited';
  permissions: {
    canCreatePasswords: boolean;
    canEditPasswords: boolean;
    canDeletePasswords: boolean;
    canSharePasswords: boolean;
    canManageMembers: boolean;
    canViewAuditLogs: boolean;
    canManageBilling: boolean;
  };
  invitedAt?: Date;
  joinedAt?: Date;
  lastActiveAt?: Date;
}

interface TeamInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: TeamMember['role'];
  invitedBy: string;
  token: string;
  expiresAt: Date;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  createdAt: Date;
}

export class TeamManagementService {
  private static readonly INVITATION_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days
  private static readonly MAX_MEMBERS_FREE = 5;
  private static readonly MAX_MEMBERS_PRO = 50;
  private static readonly MAX_MEMBERS_ENTERPRISE = 1000;
  
  /**
   * Create a new organization
   */
  static async createOrganization(
    ownerId: string,
    name: string,
    plan: Organization['plan'] = 'free'
  ): Promise<Organization> {
    const supabase = createAdminClient();
    
    try {
      // Generate unique slug
      const slug = await this.generateUniqueSlug(name);
      
      // Create organization
      const { data: org, error } = await supabase
        .from('organizations')
        .insert({
          name,
          slug,
          owner_id: ownerId,
          plan,
          settings: {
            allowGuestAccess: false,
            require2FA: false,
            passwordPolicy: {
              minLength: 12,
              requireUppercase: true,
              requireLowercase: true,
              requireNumbers: true,
              requireSymbols: true,
            },
            sessionTimeout: 24 * 60 * 60, // 24 hours
            maxMembers: this.getMaxMembersForPlan(plan),
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
        
      if (error) {
        throw new Error(`Failed to create organization: ${error.message}`);
      }
      
      // Add owner as admin
      await this.addMember(org.id, ownerId, 'owner', ownerId);
      
      // Create default shared vault
      await this.createSharedVault(org.id, 'Default Vault', ownerId);
      
      // Log organization creation
      await auditLogger.log({
        action: 'organization_created',
        resourceType: 'organization',
        userId: ownerId,
        metadata: { organizationId: org.id, name, plan },
        status: 'success'
      });
      
      // Invalidate cache
      await cache.invalidateByTags([`user:${ownerId}:organizations`]);
      
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        ownerId: org.owner_id,
        plan: org.plan,
        settings: org.settings,
        createdAt: new Date(org.created_at),
        updatedAt: new Date(org.updated_at),
      };
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId: ownerId,
        error: error?.message,
      });
      throw error;
    }
  }
  
  /**
   * Invite a user to the organization
   */
  static async inviteMember(
    organizationId: string,
    email: string,
    role: TeamMember['role'],
    invitedBy: string
  ): Promise<TeamInvitation> {
    const supabase = createAdminClient();
    
    try {
      // Verify inviter permissions
      const canInvite = await this.canUserManageMembers(organizationId, invitedBy);
      if (!canInvite) {
        throw new Error('Insufficient permissions to invite members');
      }
      
      // Check organization limits
      const memberCount = await this.getMemberCount(organizationId);
      const maxMembers = await this.getMaxMembersForOrganization(organizationId);
      
      if (memberCount >= maxMembers) {
        throw new Error('Organization member limit reached');
      }
      
      // Check if user already exists
      const existingMember = await this.getMemberByEmail(organizationId, email);
      if (existingMember) {
        throw new Error('User is already a member of this organization');
      }
      
      // Generate invitation token
      const token = EncryptionService.generateSecureRandom(64);
      const expiresAt = new Date(Date.now() + this.INVITATION_EXPIRY);
      
      // Create invitation
      const { data: invitation, error } = await supabase
        .from('team_invitations')
        .insert({
          organization_id: organizationId,
          email,
          role,
          invited_by: invitedBy,
          token,
          expires_at: expiresAt.toISOString(),
          status: 'pending',
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
        
      if (error) {
        throw new Error(`Failed to create invitation: ${error.message}`);
      }
      
      // Send invitation email
      await this.sendInvitationEmail(email, {
        organizationId,
        inviterName: await this.getUserName(invitedBy),
        role,
        token,
        expiresAt,
      });
      
      // Log invitation
      await auditLogger.log({
        action: 'member_invited',
        resourceType: 'organization',
        userId: invitedBy,
        metadata: {
          organizationId,
          email,
          role,
          invitationId: invitation.id,
        },
        status: 'success'
      });
      
      return {
        id: invitation.id,
        organizationId: invitation.organization_id,
        email: invitation.email,
        role: invitation.role,
        invitedBy: invitation.invited_by,
        token: invitation.token,
        expiresAt: new Date(invitation.expires_at),
        status: invitation.status,
        createdAt: new Date(invitation.created_at),
      };
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId: invitedBy,
        organizationId,
        error: error?.message,
      });
      throw error;
    }
  }
  
  /**
   * Accept team invitation
   */
  static async acceptInvitation(
    token: string,
    userId: string
  ): Promise<TeamMember> {
    const supabase = createAdminClient();
    
    try {
      // Get invitation
      const { data: invitation, error } = await supabase
        .from('team_invitations')
        .select('*')
        .eq('token', token)
        .eq('status', 'pending')
        .single();
        
      if (error || !invitation) {
        throw new Error('Invalid or expired invitation');
      }
      
      if (new Date(invitation.expires_at) < new Date()) {
        throw new Error('Invitation has expired');
      }
      
      // Get user email
      const { data: user } = await supabase.auth.admin.getUserById(userId);
      if (!user.user || user.user.email !== invitation.email) {
        throw new Error('Email mismatch');
      }
      
      // Add user to organization
      const member = await this.addMember(
        invitation.organization_id,
        userId,
        invitation.role,
        invitation.invited_by
      );
      
      // Update invitation status
      await supabase
        .from('team_invitations')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString(),
        })
        .eq('id', invitation.id);
      
      // Log acceptance
      await auditLogger.log({
        action: 'invitation_accepted',
        resourceType: 'organization',
        userId,
        metadata: {
          organizationId: invitation.organization_id,
          invitationId: invitation.id,
        },
        status: 'success'
      });
      
      return member;
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId,
        error: error?.message,
      });
      throw error;
    }
  }
  
  /**
   * Get organization members
   */
  static async getMembers(organizationId: string): Promise<TeamMember[]> {
    const supabase = createClient();
    
    const { data: members } = await supabase
      .from('team_members')
      .select(`
        *,
        user:user_id (
          email,
          last_sign_in_at
        )
      `)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
      
    return members?.map(member => ({
      id: member.id,
      organizationId: member.organization_id,
      userId: member.user_id,
      email: member.user.email,
      role: member.role,
      status: member.status,
      permissions: member.permissions,
      invitedAt: member.invited_at ? new Date(member.invited_at) : undefined,
      joinedAt: member.joined_at ? new Date(member.joined_at) : undefined,
      lastActiveAt: member.user.last_sign_in_at ? new Date(member.user.last_sign_in_at) : undefined,
    })) || [];
  }
  
  /**
   * Update member role and permissions
   */
  static async updateMember(
    organizationId: string,
    memberId: string,
    updates: {
      role?: TeamMember['role'];
      permissions?: Partial<TeamMember['permissions']>;
      status?: TeamMember['status'];
    },
    updatedBy: string
  ): Promise<TeamMember> {
    const supabase = createAdminClient();
    
    try {
      // Verify permissions
      const canUpdate = await this.canUserManageMembers(organizationId, updatedBy);
      if (!canUpdate) {
        throw new Error('Insufficient permissions to update members');
      }
      
      // Get current member
      const { data: currentMember } = await supabase
        .from('team_members')
        .select('*')
        .eq('id', memberId)
        .eq('organization_id', organizationId)
        .single();
        
      if (!currentMember) {
        throw new Error('Member not found');
      }
      
      // Prevent demoting the owner
      if (currentMember.role === 'owner' && updates.role && updates.role !== 'owner') {
        throw new Error('Cannot change owner role');
      }
      
      // Update member
      const { data: updatedMember, error } = await supabase
        .from('team_members')
        .update({
          role: updates.role,
          permissions: updates.permissions ? {
            ...currentMember.permissions,
            ...updates.permissions,
          } : currentMember.permissions,
          status: updates.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', memberId)
        .select()
        .single();
        
      if (error) {
        throw new Error(`Failed to update member: ${error.message}`);
      }
      
      // Log update
      await auditLogger.log({
        action: 'member_updated',
        resourceType: 'organization',
        userId: updatedBy,
        metadata: {
          organizationId,
          memberId,
          updates,
          previousRole: currentMember.role,
        },
        status: 'success'
      });
      
      // Invalidate cache
      await cache.invalidateByTags([`org:${organizationId}:members`]);
      
      return {
        id: updatedMember.id,
        organizationId: updatedMember.organization_id,
        userId: updatedMember.user_id,
        email: '', // Would need to fetch from user table
        role: updatedMember.role,
        status: updatedMember.status,
        permissions: updatedMember.permissions,
        invitedAt: updatedMember.invited_at ? new Date(updatedMember.invited_at) : undefined,
        joinedAt: updatedMember.joined_at ? new Date(updatedMember.joined_at) : undefined,
      };
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId: updatedBy,
        organizationId,
        memberId,
        error: error?.message,
      });
      throw error;
    }
  }
  
  /**
   * Remove member from organization
   */
  static async removeMember(
    organizationId: string,
    memberId: string,
    removedBy: string
  ): Promise<void> {
    const supabase = createAdminClient();
    
    try {
      // Verify permissions
      const canRemove = await this.canUserManageMembers(organizationId, removedBy);
      if (!canRemove) {
        throw new Error('Insufficient permissions to remove members');
      }
      
      // Get member details
      const { data: member } = await supabase
        .from('team_members')
        .select('*')
        .eq('id', memberId)
        .eq('organization_id', organizationId)
        .single();
        
      if (!member) {
        throw new Error('Member not found');
      }
      
      // Prevent removing the owner
      if (member.role === 'owner') {
        throw new Error('Cannot remove organization owner');
      }
      
      // Remove member
      await supabase
        .from('team_members')
        .delete()
        .eq('id', memberId);
      
      // Revoke access to shared resources
      await this.revokeMemberAccess(organizationId, member.user_id);
      
      // Log removal
      await auditLogger.log({
        action: 'member_removed',
        resourceType: 'organization',
        userId: removedBy,
        metadata: {
          organizationId,
          memberId,
          removedUserId: member.user_id,
        },
        status: 'success'
      });
      
      // Invalidate cache
      await cache.invalidateByTags([`org:${organizationId}:members`]);
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId: removedBy,
        organizationId,
        memberId,
        error: error?.message,
      });
      throw error;
    }
  }
  
  /**
   * Create shared vault for organization
   */
  static async createSharedVault(
    organizationId: string,
    name: string,
    createdBy: string
  ): Promise<{ id: string; name: string }> {
    const supabase = createAdminClient();
    
    try {
      // Verify permissions
      const canCreate = await this.canUserCreatePasswords(organizationId, createdBy);
      if (!canCreate) {
        throw new Error('Insufficient permissions to create shared vaults');
      }
      
      const vaultId = EncryptionService.generateSecureRandom(32);
      
      const { data: vault, error } = await supabase
        .from('shared_vaults')
        .insert({
          id: vaultId,
          organization_id: organizationId,
          name,
          created_by: createdBy,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();
        
      if (error) {
        throw new Error(`Failed to create shared vault: ${error.message}`);
      }
      
      // Log creation
      await auditLogger.log({
        action: 'shared_vault_created',
        resourceType: 'vault',
        userId: createdBy,
        metadata: { organizationId, vaultId, name },
        status: 'success'
      });
      
      return { id: vault.id, name: vault.name };
      
    } catch (error: any) {
      await auditLogger.logSecurityEvent('auth_failure', {
        userId: createdBy,
        organizationId,
        error: error?.message,
      });
      throw error;
    }
  }
  
  /**
   * Get user's organizations
   */
  static async getUserOrganizations(userId: string): Promise<Organization[]> {
    const cacheKey = `user:${userId}:organizations`;
    
    // Try cache first
    const cached = await cache.get<Organization[]>(cacheKey);
    if (cached) return cached;
    
    const supabase = createClient();
    
    const { data: memberships } = await supabase
      .from('team_members')
      .select(`
        organization:organization_id (
          id,
          name,
          slug,
          owner_id,
          plan,
          settings,
          created_at,
          updated_at
        )
      `)
      .eq('user_id', userId)
      .eq('status', 'active');
      
    const organizations = memberships?.map((m: any) => ({
      id: m.organization.id,
      name: m.organization.name,
      slug: m.organization.slug,
      ownerId: m.organization.owner_id,
      plan: m.organization.plan,
      settings: m.organization.settings,
      createdAt: new Date(m.organization.created_at),
      updatedAt: new Date(m.organization.updated_at),
    })) || [];
    
    // Cache for 5 minutes
    await cache.set(cacheKey, organizations, { ttl: 300 });
    
    return organizations;
  }
  
  /**
   * Helper methods
   */
  private static async generateUniqueSlug(name: string): Promise<string> {
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    let slug = baseSlug;
    let counter = 1;
    
    const supabase = createAdminClient();
    
    while (true) {
      const { data } = await supabase
        .from('organizations')
        .select('id')
        .eq('slug', slug)
        .single();
        
      if (!data) break;
      
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    
    return slug;
  }
  
  private static async addMember(
    organizationId: string,
    userId: string,
    role: TeamMember['role'],
    addedBy: string
  ): Promise<TeamMember> {
    const supabase = createAdminClient();
    
    const permissions = this.getDefaultPermissions(role);
    
    const { data: member, error } = await supabase
      .from('team_members')
      .insert({
        organization_id: organizationId,
        user_id: userId,
        role,
        status: 'active',
        permissions,
        joined_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .select()
      .single();
      
    if (error) {
      throw new Error(`Failed to add member: ${error.message}`);
    }
    
    return {
      id: member.id,
      organizationId: member.organization_id,
      userId: member.user_id,
      email: '', // Would need to fetch
      role: member.role,
      status: member.status,
      permissions: member.permissions,
      joinedAt: new Date(member.joined_at),
    };
  }
  
  private static getDefaultPermissions(role: TeamMember['role']): TeamMember['permissions'] {
    const permissions = {
      canCreatePasswords: false,
      canEditPasswords: false,
      canDeletePasswords: false,
      canSharePasswords: false,
      canManageMembers: false,
      canViewAuditLogs: false,
      canManageBilling: false,
    };
    
    switch (role) {
      case 'owner':
      case 'admin':
        return {
          canCreatePasswords: true,
          canEditPasswords: true,
          canDeletePasswords: true,
          canSharePasswords: true,
          canManageMembers: true,
          canViewAuditLogs: true,
          canManageBilling: true,
        };
      case 'member':
        return {
          canCreatePasswords: true,
          canEditPasswords: true,
          canDeletePasswords: false,
          canSharePasswords: true,
          canManageMembers: false,
          canViewAuditLogs: false,
          canManageBilling: false,
        };
      case 'viewer':
        return {
          canCreatePasswords: false,
          canEditPasswords: false,
          canDeletePasswords: false,
          canSharePasswords: false,
          canManageMembers: false,
          canViewAuditLogs: false,
          canManageBilling: false,
        };
      case 'guest':
        return {
          canCreatePasswords: false,
          canEditPasswords: false,
          canDeletePasswords: false,
          canSharePasswords: false,
          canManageMembers: false,
          canViewAuditLogs: false,
          canManageBilling: false,
        };
    }
  }
  
  private static async canUserManageMembers(organizationId: string, userId: string): Promise<boolean> {
    const supabase = createClient();
    
    const { data: member } = await supabase
      .from('team_members')
      .select('role, permissions')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();
      
    return member?.permissions?.canManageMembers || member?.role === 'owner' || member?.role === 'admin';
  }
  
  private static async canUserCreatePasswords(organizationId: string, userId: string): Promise<boolean> {
    const supabase = createClient();
    
    const { data: member } = await supabase
      .from('team_members')
      .select('permissions')
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();
      
    return member?.permissions?.canCreatePasswords || false;
  }
  
  private static async getMemberCount(organizationId: string): Promise<number> {
    const supabase = createClient();
    
    const { count } = await supabase
      .from('team_members')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'active');
      
    return count || 0;
  }
  
  private static async getMaxMembersForOrganization(organizationId: string): Promise<number> {
    const supabase = createClient();
    
    const { data: org } = await supabase
      .from('organizations')
      .select('plan')
      .eq('id', organizationId)
      .single();
      
    return this.getMaxMembersForPlan(org?.plan || 'free');
  }
  
  private static getMaxMembersForPlan(plan: Organization['plan']): number {
    switch (plan) {
      case 'free': return this.MAX_MEMBERS_FREE;
      case 'pro': return this.MAX_MEMBERS_PRO;
      case 'enterprise': return this.MAX_MEMBERS_ENTERPRISE;
    }
  }
  
  private static async getMemberByEmail(organizationId: string, email: string): Promise<TeamMember | null> {
    const supabase = createClient();
    
    const { data: member } = await supabase
      .from('team_members')
      .select(`
        *,
        user:user_id (email)
      `)
      .eq('organization_id', organizationId)
      .eq('user.email', email)
      .single();
      
    return member ? {
      id: member.id,
      organizationId: member.organization_id,
      userId: member.user_id,
      email: member.user.email,
      role: member.role,
      status: member.status,
      permissions: member.permissions,
      invitedAt: member.invited_at ? new Date(member.invited_at) : undefined,
      joinedAt: member.joined_at ? new Date(member.joined_at) : undefined,
    } : null;
  }
  
  private static async getUserName(userId: string): Promise<string> {
    const supabase = createClient();
    
    const { data: user } = await supabase.auth.admin.getUserById(userId);
    return user.user?.email || 'Unknown User';
  }
  
  private static async sendInvitationEmail(email: string, data: any): Promise<void> {
    // Implementation would send email via your email service
    console.log(`Sending invitation email to ${email}`);
  }
  
  private static async revokeMemberAccess(organizationId: string, userId: string): Promise<void> {
    const supabase = createAdminClient();
    
    // Revoke access to shared passwords
    await supabase
      .from('password_access')
      .update({ revoked: true })
      .eq('user_id', userId);
      
    // Revoke access to shared vaults
    await supabase
      .from('vault_access')
      .delete()
      .eq('user_id', userId);
  }
}

// Export singleton
export const teamManagement = new TeamManagementService();
