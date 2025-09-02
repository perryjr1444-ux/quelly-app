import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const securityHeaders = {
  // Prevent clickjacking attacks
  'X-Frame-Options': 'DENY',
  
  // Prevent MIME type sniffing
  'X-Content-Type-Options': 'nosniff',
  
  // Enable XSS protection
  'X-XSS-Protection': '1; mode=block',
  
  // Control referrer information
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  
  // HSTS - Force HTTPS
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  
  // Permissions Policy
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  
  // DNS Prefetch Control
  'X-DNS-Prefetch-Control': 'on',
  
  // Download Options
  'X-Download-Options': 'noopen',
  
  // Permitted Cross-Domain Policies
  'X-Permitted-Cross-Domain-Policies': 'none',
  // Cross-Origin Isolation & Resource Policy
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-site',
  'Origin-Agent-Cluster': '?1',
};

// Content Security Policy
export function generateCSP(nonce?: string): string {
  const directives = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      nonce ? `'nonce-${nonce}'` : '',
      "'strict-dynamic'",
      'https://*.supabase.co',
      'https://*.posthog.com',
      'https://*.sentry.io',
      process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : '',
    ].filter(Boolean),
    'style-src': ["'self'", "'unsafe-inline'"], // Required for Tailwind
    'img-src': ["'self'", 'data:', 'https:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': [
      "'self'",
      'https://*.supabase.co',
      'wss://*.supabase.co',
      'https://*.posthog.com',
      'https://*.sentry.io',
      'https://api.stripe.com',
    ],
    'media-src': ["'self'"],
    'object-src': ["'none'"],
    'frame-src': ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'upgrade-insecure-requests': [],
  };

  return Object.entries(directives)
    .map(([key, values]) => {
      if (values.length === 0) return key;
      return `${key} ${values.join(' ')}`;
    })
    .join('; ');
}

export function applySecurityHeaders(response: NextResponse, nonce?: string): NextResponse {
  // Apply all security headers
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Apply CSP
  const csp = generateCSP(nonce);
  response.headers.set('Content-Security-Policy', csp);

  return response;
}
