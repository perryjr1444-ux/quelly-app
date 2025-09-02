"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { NotificationContainer, NotificationProps, NotificationType } from '@/components/ui/notification';

interface NotificationContextValue {
  notify: (options: Omit<NotificationProps, 'id'>) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationProps[]>([]);

  const notify = useCallback((options: Omit<NotificationProps, 'id'>) => {
    const id = `notification-${Date.now()}-${Math.random()}`;
    setNotifications((prev) => [...prev, { ...options, id }]);
  }, []);

  const createNotifier = (type: NotificationType) => 
    useCallback((title: string, message?: string) => {
      notify({ type, title, message });
    }, [notify, type]);

  const handleClose = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const value: NotificationContextValue = {
    notify,
    success: createNotifier('success'),
    error: createNotifier('error'),
    warning: createNotifier('warning'),
    info: createNotifier('info'),
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationContainer notifications={notifications} onClose={handleClose} />
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
