import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { applySecurityHeaders } from '@/lib/security/headers';

// Protected routes configuration
const PROTECTED_ROUTES = [
  '/dashboard',
  '/api/passwords',
  '/api/check',
  '/api/billing',
  '/api/credits',
  '/api/admin',
];

const PUBLIC_API_ROUTES = [
  '/api/health',
  '/api/auth/magic-link',
  '/api/auth/otac/claim',
  '/api/stripe/webhook',
  '/api/credits/webhook',
];

export async function middleware(req: NextRequest) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  
  // Generate nonce for CSP
  const nonce = Math.random().toString(36).substring(2, 15);
  
  // Check if route is protected
  const isProtected = PROTECTED_ROUTES.some(route => pathname.startsWith(route));
  const isPublicAPI = PUBLIC_API_ROUTES.some(route => pathname.startsWith(route));
  
  // Create response
  let response = NextResponse.next({
    request: {
      headers: new Headers(req.headers),
    },
  });
  
  // Add nonce to request headers for use in components
  response.headers.set('x-nonce', nonce);
  
  // Apply security headers to all responses
  response = applySecurityHeaders(response, nonce);
  
  // CSRF: Enforce same-origin on state-changing API requests
  if (pathname.startsWith('/api/') && !['GET','HEAD','OPTIONS'].includes(req.method)) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    const allowed = [
      process.env.NEXT_PUBLIC_SITE_URL,
      `https://${host}`,
      `http://${host}`,
    ].filter(Boolean) as string[];
    const ok = origin && allowed.some(a => origin!.startsWith(a));
    if (!ok) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  // Ensure sensitive API responses are not cached by intermediaries
  if (pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Pragma', 'no-cache');
  }

  // Authentication check for protected routes
  if (isProtected && !isPublicAPI) {
    const hasAuthCookie = req.cookies.has('sb-access-token') || 
                         req.cookies.has('supabase-auth-token') ||
                         req.cookies.has('sb-refresh-token');
    
    if (!hasAuthCookie) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
    
    // Admin routes require additional checks (will be handled in the route itself)
  }
  
  // Add request ID for tracing
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  response.headers.set('x-request-id', requestId);
  
  // Add security headers for API responses
  if (pathname.startsWith('/api/')) {
    response.headers.set('Content-Type', 'application/json');
    response.headers.set('X-Content-Type-Options', 'nosniff');
  }
  
  return response;
}

export const config = { 
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
};
