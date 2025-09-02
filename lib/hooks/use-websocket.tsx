'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface UseWebSocketOptions {
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
}

interface WebSocketState {
  connected: boolean;
  connecting: boolean;
  error: Error | null;
  lastPing?: number;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    autoConnect = true,
    reconnection = true,
    reconnectionAttempts = 5,
    reconnectionDelay = 1000,
  } = options;

  const [state, setState] = useState<WebSocketState>({
    connected: false,
    connecting: false,
    error: null,
  });

  const socketRef = useRef<Socket | null>(null);
  const router = useRouter();
  const reconnectAttemptsRef = useRef(0);

  // Initialize socket connection
  const connect = useCallback(async () => {
    if (socketRef.current?.connected) return;

    setState(prev => ({ ...prev, connecting: true, error: null }));

    try {
      // Get authentication data
      const sessionData = await getSessionData();
      if (!sessionData) {
        throw new Error('No active session');
      }

      // Create socket connection
      const socket = io(process.env.NEXT_PUBLIC_WEBSOCKET_URL || '/', {
        auth: {
          token: sessionData.token,
          sessionId: sessionData.sessionId,
        },
        transports: ['websocket', 'polling'],
        reconnection,
        reconnectionAttempts,
        reconnectionDelay,
      });

      // Connection event handlers
      socket.on('connect', () => {
        setState(prev => ({ ...prev, connected: true, connecting: false }));
        reconnectAttemptsRef.current = 0;
        console.log('WebSocket connected');
      });

      socket.on('disconnect', (reason) => {
        setState(prev => ({ ...prev, connected: false }));
        console.log('WebSocket disconnected:', reason);

        if (reason === 'io server disconnect') {
          // Server disconnected us, likely auth issue
          router.push('/login');
        }
      });

      socket.on('connect_error', (error) => {
        setState(prev => ({ ...prev, error, connecting: false }));
        console.error('WebSocket connection error:', error.message);

        reconnectAttemptsRef.current++;
        if (reconnectAttemptsRef.current >= reconnectionAttempts) {
          toast.error('Failed to establish real-time connection');
        }
      });

      // Security event handlers
      socket.on('security:alert', (alert) => {
        toast.error(alert.message || 'Security alert', {
          duration: 10000,
          action: {
            label: 'View',
            onClick: () => router.push('/dashboard/security'),
          },
        });
      });

      // Notification handlers
      socket.on('notification:new', (notification) => {
        toast(notification.title, {
          description: notification.message,
          action: notification.action ? {
            label: notification.action.label,
            onClick: () => router.push(notification.action.url),
          } : undefined,
        });
      });

      // Session handlers
      socket.on('session:expired', () => {
        toast.error('Your session has expired');
        router.push('/login');
      });

      socket.on('session:revoked', () => {
        toast.error('Your session has been revoked');
        router.push('/login');
      });

      // Ping/pong for connection health
      const pingInterval = setInterval(() => {
        if (socket.connected) {
          const start = Date.now();
          socket.emit('ping');
          socket.once('pong', () => {
            setState(prev => ({ ...prev, lastPing: Date.now() - start }));
          });
        }
      }, 30000);

      socket.on('disconnect', () => {
        clearInterval(pingInterval);
      });

      socketRef.current = socket;

    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error as Error,
        connecting: false,
      }));
      console.error('Failed to connect WebSocket:', error);
    }
  }, [reconnection, reconnectionAttempts, reconnectionDelay, router]);

  // Disconnect socket
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  // Emit event
  const emit = useCallback((event: string, data?: any) => {
    if (!socketRef.current?.connected) {
      console.warn('Cannot emit event: WebSocket not connected');
      return;
    }
    socketRef.current.emit(event, data);
  }, []);

  // Subscribe to event
  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    if (!socketRef.current) {
      console.warn('Cannot subscribe to event: WebSocket not initialized');
      return () => {};
    }

    socketRef.current.on(event, handler);

    // Return unsubscribe function
    return () => {
      socketRef.current?.off(event, handler);
    };
  }, []);

  // Subscribe to event (once)
  const once = useCallback((event: string, handler: (...args: any[]) => void) => {
    if (!socketRef.current) {
      console.warn('Cannot subscribe to event: WebSocket not initialized');
      return () => {};
    }

    socketRef.current.once(event, handler);

    // Return unsubscribe function
    return () => {
      socketRef.current?.off(event, handler);
    };
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    ...state,
    socket: socketRef.current,
    connect,
    disconnect,
    emit,
    on,
    once,
  };
}

// Hook for password real-time updates
export function usePasswordRealtime(passwordId?: string) {
  const { socket, on, emit, connected } = useWebSocket();
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [cursors, setCursors] = useState<Map<string, any>>(new Map());

  useEffect(() => {
    if (!connected || !passwordId) return;

    // Join collaboration room
    emit('collaboration:join', passwordId);

    // Set up event listeners
    const unsubscribers = [
      on('collaborators:list', (users) => {
        setCollaborators(users);
      }),
      
      on('collaborator:joined', (data) => {
        setCollaborators(prev => [...prev, data.userId]);
      }),
      
      on('collaborator:left', (data) => {
        setCollaborators(prev => prev.filter(id => id !== data.userId));
        setCursors(prev => {
          const next = new Map(prev);
          next.delete(data.userId);
          return next;
        });
      }),
      
      on('collaborator:cursor', (data) => {
        setCursors(prev => {
          const next = new Map(prev);
          next.set(data.userId, {
            position: data.position,
            selection: data.selection,
          });
          return next;
        });
      }),
    ];

    // Cleanup
    return () => {
      emit('collaboration:leave', passwordId);
      unsubscribers.forEach(unsub => unsub());
    };
  }, [connected, passwordId, emit, on]);

  const updateCursor = useCallback((position: any, selection?: any) => {
    if (!connected || !passwordId) return;
    
    emit('collaboration:cursor', {
      passwordId,
      position,
      selection,
    });
  }, [connected, passwordId, emit]);

  return {
    collaborators,
    cursors,
    updateCursor,
  };
}

// Hook for presence tracking
export function usePresence() {
  const { on, emit, connected } = useWebSocket();
  const [presence, setPresence] = useState<Map<string, any>>(new Map());

  useEffect(() => {
    if (!connected) return;

    const unsubscribe = on('presence:update', (data) => {
      setPresence(prev => {
        const next = new Map(prev);
        if (data.status === 'offline') {
          next.delete(data.userId);
        } else {
          next.set(data.userId, data);
        }
        return next;
      });
    });

    return unsubscribe;
  }, [connected, on]);

  const updateStatus = useCallback((status: string) => {
    if (!connected) return;
    emit('presence:update', status);
  }, [connected, emit]);

  return {
    presence,
    updateStatus,
    onlineUsers: Array.from(presence.keys()),
  };
}

// Hook for real-time metrics (admin only)
export function useRealtimeMetrics() {
  const { on, emit, connected } = useWebSocket();
  const [metrics, setMetrics] = useState<any>(null);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!connected || subscribed) return;

    // Subscribe to metrics
    emit('subscribe:metrics');
    setSubscribed(true);

    const unsubscribe = on('metrics:update', (data) => {
      setMetrics(data);
    });

    return () => {
      unsubscribe();
    };
  }, [connected, subscribed, emit, on]);

  return metrics;
}

// Helper function to get session data
async function getSessionData(): Promise<{ token: string; sessionId: string } | null> {
  try {
    // This would be implemented based on your session storage strategy
    // For example, from cookies or localStorage
    const response = await fetch('/api/auth/session');
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
