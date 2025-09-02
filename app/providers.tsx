"use client";

import React, { useEffect } from "react";
import posthog from 'posthog-js';
import { PostHogProvider } from 'posthog-js/react';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
    if (key) {
      posthog.init(key, { api_host: host, capture_pageview: true });
    }
  }, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <PostHogProvider client={posthog}>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </PostHogProvider>
    </ThemeProvider>
  );
}
