import { Server as HTTPServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { auditLogger } from '@/lib/audit/logger';
import { SessionSecurityService } from '@/lib/security/session-security';
import { cache } from '@/lib/cache/redis';

/**
 * WebSocket service for real-time updates
 * Features:
 * - Real-time password updates
 * - Live collaboration
 * - Security event notifications
 * - Performance metrics streaming
 * - Presence tracking
 */

interface AuthenticatedSocket extends Socket {
  userId?: string;
  sessionId?: string;
  organizationId?: string;
}

interface RealtimeEvent {
  type: string;
  payload: any;
  timestamp: number;
  userId?: string;
  organizationId?: string;
}

export class WebSocketService {
  private io: SocketServer | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;
  private presenceMap = new Map<string, Set<string>>();
  
  /**
   * Initialize WebSocket server
   */
  async initialize(server: HTTPServer) {
    try {
      // Create Socket.IO server
      this.io = new SocketServer(server, {
        cors: {
          origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
          credentials: true,
        },
        transports: ['websocket', 'polling'],
        pingTimeout: 60000,
        pingInterval: 25000,
      });
      
      // Set up Redis adapter for scaling
      if (process.env.REDIS_URL) {
        this.pubClient = new Redis(process.env.REDIS_URL);
        this.subClient = this.pubClient.duplicate();
        
        this.io.adapter(createAdapter(this.pubClient, this.subClient));
      }
      
      // Authentication middleware
      this.io.use(async (socket: AuthenticatedSocket, next) => {
        try {
          const token = socket.handshake.auth.token;
          const sessionId = socket.handshake.auth.sessionId;
          
          if (!token || !sessionId) {
            return next(new Error('Authentication required'));
          }
          
          // Validate session
          const session = await SessionSecurityService.validateSecureSession(sessionId, token);
          
          if (!session.valid || !session.userId) {
            return next(new Error('Invalid session'));
          }
          
          // Attach user info to socket
          socket.userId = session.userId;
          socket.sessionId = sessionId;
          
          // Get user's organization
          const org = await this.getUserOrganization(session.userId);
          if (org) {
            socket.organizationId = org.id;
          }
          
          next();
        } catch (error) {
          next(new Error('Authentication failed'));
        }
      });
      
      // Connection handler
      this.io.on('connection', (socket: AuthenticatedSocket) => {
        this.handleConnection(socket);
      });
      
      // Set up event listeners for system events
      this.setupSystemEventListeners();
      
      console.log('WebSocket server initialized');
      
    } catch (error) {
      console.error('Failed to initialize WebSocket server:', error);
      throw error;
    }
  }
  
  /**
   * Handle new socket connection
   */
  private handleConnection(socket: AuthenticatedSocket) {
    const { userId, organizationId } = socket;
    
    if (!userId) return;
    
    // Join user room
    socket.join(`user:${userId}`);
    
    // Join organization room if applicable
    if (organizationId) {
      socket.join(`org:${organizationId}`);
    }
    
    // Update presence
    this.updatePresence(userId, 'online');
    
    // Set up event handlers
    this.setupSocketHandlers(socket);
    
    // Send initial data
    this.sendInitialData(socket);
    
    // Log connection
    auditLogger.log({
      action: 'websocket_connected',
      resourceType: 'realtime',
      userId,
      metadata: { socketId: socket.id },
      status: 'success'
    });
    
    // Handle disconnect
    socket.on('disconnect', (reason) => {
      this.handleDisconnect(socket, reason);
    });
  }
  
  /**
   * Set up socket event handlers
   */
  private setupSocketHandlers(socket: AuthenticatedSocket) {
    // Subscribe to password updates
    socket.on('subscribe:passwords', async (data) => {
      if (!socket.userId) return;
      
      const room = `passwords:${socket.userId}`;
      socket.join(room);
      
      // Send current passwords
      const passwords = await this.getUserPasswords(socket.userId);
      socket.emit('passwords:snapshot', passwords);
    });
    
    // Subscribe to organization updates
    socket.on('subscribe:organization', async (data) => {
      if (!socket.organizationId) return;
      
      const room = `org:${socket.organizationId}:updates`;
      socket.join(room);
      
      // Send organization data
      const orgData = await this.getOrganizationData(socket.organizationId);
      socket.emit('organization:snapshot', orgData);
    });
    
    // Handle password operations
    socket.on('password:create', async (data) => {
      await this.handlePasswordCreate(socket, data);
    });
    
    socket.on('password:update', async (data) => {
      await this.handlePasswordUpdate(socket, data);
    });
    
    socket.on('password:delete', async (data) => {
      await this.handlePasswordDelete(socket, data);
    });
    
    // Handle presence updates
    socket.on('presence:update', (status) => {
      if (socket.userId) {
        this.updatePresence(socket.userId, status);
      }
    });
    
    // Handle collaboration
    socket.on('collaboration:join', async (passwordId) => {
      await this.handleCollaborationJoin(socket, passwordId);
    });
    
    socket.on('collaboration:leave', async (passwordId) => {
      await this.handleCollaborationLeave(socket, passwordId);
    });
    
    socket.on('collaboration:cursor', async (data) => {
      await this.handleCollaborationCursor(socket, data);
    });
    
    // Handle metrics subscription
    socket.on('subscribe:metrics', async () => {
      if (!socket.userId || !await this.isAdmin(socket.userId)) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }
      
      socket.join('metrics:stream');
      this.startMetricsStreaming(socket);
    });
  }
  
  /**
   * Send initial data to connected client
   */
  private async sendInitialData(socket: AuthenticatedSocket) {
    if (!socket.userId) return;
    
    try {
      // Send user preferences
      const preferences = await cache.get(`user:${socket.userId}:preferences`);
      if (preferences) {
        socket.emit('preferences:update', preferences);
      }
      
      // Send unread notifications count
      const unreadCount = await this.getUnreadNotificationsCount(socket.userId);
      socket.emit('notifications:count', unreadCount);
      
      // Send active sessions count
      const activeSessions = await this.getActiveSessionsCount(socket.userId);
      socket.emit('sessions:count', activeSessions);
      
    } catch (error) {
      console.error('Error sending initial data:', error);
    }
  }
  
  /**
   * Handle password creation in real-time
   */
  private async handlePasswordCreate(socket: AuthenticatedSocket, data: any) {
    if (!socket.userId) return;
    
    try {
      // Validate permissions
      if (!await this.canCreatePassword(socket.userId)) {
        socket.emit('error', { message: 'Quota exceeded' });
        return;
      }
      
      // Create password (actual creation handled by API)
      // This just notifies other clients
      const event: RealtimeEvent = {
        type: 'password:created',
        payload: data,
        timestamp: Date.now(),
        userId: socket.userId,
      };
      
      // Broadcast to user's devices
      socket.to(`user:${socket.userId}`).emit('password:created', event);
      
      // Broadcast to organization if shared
      if (socket.organizationId && data.shared) {
        socket.to(`org:${socket.organizationId}`).emit('password:created', event);
      }
      
      // Update cache
      await cache.invalidateByTags([`passwords:${socket.userId}`]);
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to create password' });
    }
  }
  
  /**
   * Handle password update in real-time
   */
  private async handlePasswordUpdate(socket: AuthenticatedSocket, data: any) {
    if (!socket.userId) return;
    
    try {
      // Validate permissions
      if (!await this.canUpdatePassword(socket.userId, data.id)) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }
      
      const event: RealtimeEvent = {
        type: 'password:updated',
        payload: data,
        timestamp: Date.now(),
        userId: socket.userId,
      };
      
      // Broadcast update
      const room = `password:${data.id}:collaborators`;
      this.io?.to(room).emit('password:updated', event);
      
      // Update user's other devices
      socket.to(`user:${socket.userId}`).emit('password:updated', event);
      
      // Invalidate cache
      await cache.delete(`password:${data.id}`);
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to update password' });
    }
  }
  
  /**
   * Handle password deletion in real-time
   */
  private async handlePasswordDelete(socket: AuthenticatedSocket, data: any) {
    if (!socket.userId) return;
    
    try {
      // Validate permissions
      if (!await this.canDeletePassword(socket.userId, data.id)) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }
      
      const event: RealtimeEvent = {
        type: 'password:deleted',
        payload: { id: data.id },
        timestamp: Date.now(),
        userId: socket.userId,
      };
      
      // Broadcast deletion
      socket.to(`user:${socket.userId}`).emit('password:deleted', event);
      
      if (socket.organizationId) {
        socket.to(`org:${socket.organizationId}`).emit('password:deleted', event);
      }
      
      // Clean up collaboration room
      const room = `password:${data.id}:collaborators`;
      this.io?.in(room).socketsLeave(room);
      
      // Invalidate cache
      await cache.delete(`password:${data.id}`);
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to delete password' });
    }
  }
  
  /**
   * Handle collaboration join
   */
  private async handleCollaborationJoin(socket: AuthenticatedSocket, passwordId: string) {
    if (!socket.userId) return;
    
    try {
      // Check access
      if (!await this.canAccessPassword(socket.userId, passwordId)) {
        socket.emit('error', { message: 'Access denied' });
        return;
      }
      
      const room = `password:${passwordId}:collaborators`;
      socket.join(room);
      
      // Get current collaborators
      const collaborators = await this.getRoomMembers(room);
      
      // Notify others
      socket.to(room).emit('collaborator:joined', {
        userId: socket.userId,
        timestamp: Date.now(),
      });
      
      // Send current collaborators to joiner
      socket.emit('collaborators:list', collaborators);
      
    } catch (error) {
      socket.emit('error', { message: 'Failed to join collaboration' });
    }
  }
  
  /**
   * Handle collaboration leave
   */
  private async handleCollaborationLeave(socket: AuthenticatedSocket, passwordId: string) {
    if (!socket.userId) return;
    
    const room = `password:${passwordId}:collaborators`;
    socket.leave(room);
    
    // Notify others
    socket.to(room).emit('collaborator:left', {
      userId: socket.userId,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Handle collaboration cursor updates
   */
  private async handleCollaborationCursor(socket: AuthenticatedSocket, data: any) {
    if (!socket.userId) return;
    
    const room = `password:${data.passwordId}:collaborators`;
    
    // Broadcast cursor position to other collaborators
    socket.to(room).emit('collaborator:cursor', {
      userId: socket.userId,
      position: data.position,
      selection: data.selection,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Handle disconnect
   */
  private handleDisconnect(socket: AuthenticatedSocket, reason: string) {
    if (!socket.userId) return;
    
    // Update presence
    this.updatePresence(socket.userId, 'offline');
    
    // Leave all collaboration rooms
    const rooms = Array.from(socket.rooms).filter(room => 
      room.startsWith('password:') && room.endsWith(':collaborators')
    );
    
    rooms.forEach(room => {
      socket.to(room).emit('collaborator:left', {
        userId: socket.userId,
        timestamp: Date.now(),
      });
    });
    
    // Log disconnection
    auditLogger.log({
      action: 'websocket_disconnected',
      resourceType: 'realtime',
      userId: socket.userId,
      metadata: { reason },
      status: 'success'
    });
  }
  
  /**
   * Broadcast event to specific users
   */
  broadcastToUsers(userIds: string[], event: string, data: any) {
    userIds.forEach(userId => {
      this.io?.to(`user:${userId}`).emit(event, data);
    });
  }
  
  /**
   * Broadcast event to organization
   */
  broadcastToOrganization(organizationId: string, event: string, data: any) {
    this.io?.to(`org:${organizationId}`).emit(event, data);
  }
  
  /**
   * Broadcast security alert
   */
  broadcastSecurityAlert(userId: string, alert: any) {
    this.io?.to(`user:${userId}`).emit('security:alert', {
      ...alert,
      timestamp: Date.now(),
    });
  }
  
  /**
   * Stream performance metrics
   */
  private startMetricsStreaming(socket: Socket) {
    const interval = setInterval(async () => {
      try {
        const metrics = await this.collectMetrics();
        socket.emit('metrics:update', metrics);
      } catch (error) {
        console.error('Error streaming metrics:', error);
      }
    }, 5000); // Every 5 seconds
    
    socket.on('disconnect', () => {
      clearInterval(interval);
    });
  }
  
  /**
   * Update user presence
   */
  private updatePresence(userId: string, status: string) {
    const presence = {
      userId,
      status,
      lastSeen: Date.now(),
    };
    
    // Store in presence map
    if (!this.presenceMap.has(userId)) {
      this.presenceMap.set(userId, new Set());
    }
    
    // Broadcast presence update
    this.io?.emit('presence:update', presence);
    
    // Update cache
    cache.set(`presence:${userId}`, presence, { ttl: 300 });
  }
  
  /**
   * Get room members
   */
  private async getRoomMembers(room: string): Promise<string[]> {
    const sockets = await this.io?.in(room).fetchSockets();
    return sockets?.map(s => (s as any).userId).filter(Boolean) || [];
  }
  
  /**
   * Set up system event listeners
   */
  private setupSystemEventListeners() {
    // Listen for password events from other services
    if (this.subClient) {
      this.subClient.subscribe('password:events');
      this.subClient.subscribe('security:events');
      this.subClient.subscribe('notification:events');
      
      this.subClient.on('message', (channel, message) => {
        try {
          const event = JSON.parse(message);
          this.handleSystemEvent(channel, event);
        } catch (error) {
          console.error('Error handling system event:', error);
        }
      });
    }
  }
  
  /**
   * Handle system events
   */
  private handleSystemEvent(channel: string, event: any) {
    switch (channel) {
      case 'password:events':
        this.handlePasswordEvent(event);
        break;
      case 'security:events':
        this.handleSecurityEvent(event);
        break;
      case 'notification:events':
        this.handleNotificationEvent(event);
        break;
    }
  }
  
  private handlePasswordEvent(event: any) {
    // Broadcast password events to relevant users
    if (event.userId) {
      this.io?.to(`user:${event.userId}`).emit('password:event', event);
    }
    
    if (event.organizationId) {
      this.io?.to(`org:${event.organizationId}`).emit('password:event', event);
    }
  }
  
  private handleSecurityEvent(event: any) {
    // Broadcast security events
    if (event.userId) {
      this.io?.to(`user:${event.userId}`).emit('security:event', event);
    }
  }
  
  private handleNotificationEvent(event: any) {
    // Broadcast notifications
    if (event.userId) {
      this.io?.to(`user:${event.userId}`).emit('notification:new', event);
    }
  }
  
  /**
   * Helper methods (implement based on your data layer)
   */
  private async getUserOrganization(userId: string): Promise<any> {
    // Implement based on your data model
    return null;
  }
  
  private async getUserPasswords(userId: string): Promise<any[]> {
    // Implement based on your data model
    return [];
  }
  
  private async getOrganizationData(organizationId: string): Promise<any> {
    // Implement based on your data model
    return {};
  }
  
  private async canCreatePassword(userId: string): Promise<boolean> {
    // Implement permission check
    return true;
  }
  
  private async canUpdatePassword(userId: string, passwordId: string): Promise<boolean> {
    // Implement permission check
    return true;
  }
  
  private async canDeletePassword(userId: string, passwordId: string): Promise<boolean> {
    // Implement permission check
    return true;
  }
  
  private async canAccessPassword(userId: string, passwordId: string): Promise<boolean> {
    // Implement permission check
    return true;
  }
  
  private async isAdmin(userId: string): Promise<boolean> {
    // Implement admin check
    return false;
  }
  
  private async getUnreadNotificationsCount(userId: string): Promise<number> {
    // Implement based on your data model
    return 0;
  }
  
  private async getActiveSessionsCount(userId: string): Promise<number> {
    // Implement based on your data model
    return 0;
  }
  
  private async collectMetrics(): Promise<any> {
    // Implement metrics collection + decayed signal C(t)
    const base = {
      connections: this.io?.engine.clientsCount || 0,
      timestamp: Date.now(),
    } as any;
    try {
      // Lightweight fetch to local API to compute decayed value
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      const res = await fetch(`${siteUrl}/api/analytics/decayed?windowSec=3600&halfLifeSec=600`, { method: 'GET' });
      if (res.ok) {
        const json = await res.json();
        base.decayed = json?.data?.value ?? null;
      }
    } catch {}
    return base;
  }
}

// Export singleton
export const websocket = new WebSocketService();
