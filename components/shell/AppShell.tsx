"use client";

import React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const linkCls = (href: string) => `px-2 py-1 rounded ${pathname === href ? 'bg-black text-white' : ''}`;
  return (
    <div className="min-h-screen grid grid-rows-[auto,1fr]">
      <header className="border-b bg-white/60 dark:bg-white/5 backdrop-blur">
        <div className="max-w-5xl mx-auto flex items-center justify-between p-3">
          <Link href="/" className="font-semibold">PoofPass</Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/dashboard" className={linkCls('/dashboard')}>Dashboard</Link>
            <Link href="/pricing" className={linkCls('/pricing')}>Pricing</Link>
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto w-full p-4">{children}</main>
    </div>
  );
}
