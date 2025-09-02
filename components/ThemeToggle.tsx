"use client";

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  const isDark = (resolvedTheme || theme) === 'dark';
  return (
    <Button size="sm" variant="outline" onClick={() => setTheme(isDark ? 'light' : 'dark')} aria-label="Toggle theme">
      {isDark ? 'Light' : 'Dark'}
    </Button>
  );
}


