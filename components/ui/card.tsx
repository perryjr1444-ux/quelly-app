import React from 'react'
import { cn } from '@/lib/utils'

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("border rounded-lg bg-white/50 dark:bg-white/5", className)}>{children}</div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("px-4 pt-4 pb-2 border-b border-slate-200/60 dark:border-slate-700/60", className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={cn("text-base font-semibold", className)}>{children}</h3>;
}

export function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("p-4", className)}>{children}</div>;
}
