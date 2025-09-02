"use client";

import Link from "next/link";
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function ClientNavBar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true } as any);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={`sticky top-0 z-40 transition-all ${scrolled ? 'backdrop-blur border-b bg-white/60 dark:bg-black/30' : ''}`}>
      <div className="mx-auto max-w-5xl px-4 h-14 flex items-center justify-between">
        <Link href="/" className="font-semibold">Hashword</Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/pricing">Pricing</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/login" className="ml-2">Login</Link>
          <ThemeToggle />
          <Button size="sm" className="bg-blue-600" onClick={() => (window.location.href = '/pricing')}>Upgrade</Button>
        </nav>
      </div>
    </header>
  );
}


