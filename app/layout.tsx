import type { Metadata } from "next";
import "./globals.css";
import Providers from "./providers";
import Link from "next/link";
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import ClientNavBar from './nav-client';

export const metadata: Metadata = {
  title: "Hashword",
  description: "Disposable passwords made simple",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground">
        <Providers>
          <ClientNavBar />
          <main className="mx-auto max-w-5xl px-4 py-8">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}

// moved to ClientNavBar component

function Footer() {
  return (
    <footer className="border-t py-6 text-sm text-gray-500">
      <div className="mx-auto max-w-5xl px-4 flex items-center justify-between">
        <span>© {new Date().getFullYear()} Hashword</span>
        <a href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@poofpass.com'}`}>{process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@poofpass.com'}</a>
      </div>
    </footer>
  )
}
