/**
 * Progressive Web App Service Worker
 * 
 * Features:
 * - Offline functionality
 * - Background sync
 * - Push notifications
 * - Cache management
 * - Update handling
 */

const CACHE_NAME = 'poofpass-v1';
const STATIC_CACHE = 'poofpass-static-v1';
const DYNAMIC_CACHE = 'poofpass-dynamic-v1';

// Assets to cache for offline use
const STATIC_ASSETS = [
  '/',
  '/login',
  '/dashboard',
  '/offline',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// API endpoints that should work offline
const OFFLINE_ENDPOINTS = [
  '/api/health',
  '/api/auth/session',
];

// Install event - cache static assets
self.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('Service worker installed');
        return (self as any).skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event: any) => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(cacheName => 
              cacheName !== STATIC_CACHE && 
              cacheName !== DYNAMIC_CACHE
            )
            .map(cacheName => {
              console.log('Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('Service worker activated');
        return (self as any).clients.claim();
      })
  );
});

// Fetch event - implement caching strategies
self.addEventListener('fetch', (event: any) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Handle API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  // Handle static assets
  if (isStaticAsset(request)) {
    event.respondWith(handleStaticAsset(request));
    return;
  }

  // Handle page requests
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(handlePageRequest(request));
    return;
  }

  // Default: network first, cache fallback
  event.respondWith(handleDefaultRequest(request));
});

// Handle API requests with offline support
async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  
  try {
    // Try network first
    const networkResponse = await fetch(request);
    
    // Cache successful responses for offline endpoints
    if (networkResponse.ok && OFFLINE_ENDPOINTS.some(endpoint => 
      url.pathname.startsWith(endpoint)
    )) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Network failed, try cache
    const cachedResponse = await caches.match(request as any);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline response for API endpoints
    if (url.pathname.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ 
          error: 'Offline', 
          message: 'This request requires an internet connection' 
        }),
        { 
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    throw error;
  }
}

// Handle static assets with cache first strategy
async function handleStaticAsset(request: Request): Promise<Response> {
  const cachedResponse = await caches.match(request as any);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Return a fallback for critical assets
    if (request.url.includes('/icons/')) {
      return new Response('', { status: 404 });
    }
    
    throw error;
  }
}

// Handle page requests with network first, cache fallback
async function handlePageRequest(request: Request): Promise<Response> {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request as any);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page
    const offline = await caches.match('/offline' as any);
    return offline || new Response('Offline', { status: 503 });
  }
}

// Default request handler
async function handleDefaultRequest(request: Request): Promise<Response> {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request as any);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    throw error;
  }
}

// Check if request is for a static asset
function isStaticAsset(request: Request): boolean {
  const url = new URL(request.url);
  
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.woff2')
  );
}

// Background sync for offline actions
self.addEventListener('sync', (event: any) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

// Handle background sync
async function doBackgroundSync(): Promise<void> {
  try {
    // Get pending offline actions from IndexedDB
    const pendingActions = await getPendingActions();
    
    for (const action of pendingActions) {
      try {
        await syncAction(action);
        await removePendingAction(action.id);
      } catch (error) {
        console.error('Failed to sync action:', error);
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Push notification handling
self.addEventListener('push', (event: any) => {
  if (!event.data) return;
  
  const data = event.data.json();
  
  const options: any = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: data.tag || 'default',
    data: data.data,
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
  };
  
  event.waitUntil(((self as any).registration as any).showNotification(data.title, options));
});

// Notification click handling
self.addEventListener('notificationclick', (event: any) => {
  event.notification.close();
  
  const data = event.notification.data;
  const url = data?.url || '/dashboard';
  
  event.waitUntil(
    (self as any).clients.matchAll({ type: 'window' })
      .then((clientList: any[]) => {
        // Check if app is already open
        for (const client of clientList) {
          if ((client as any).url.includes((self as any).location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Open new window
        if ((self as any).clients.openWindow) {
          return (self as any).clients.openWindow(url);
        }
      })
  );
});

// Message handling for communication with main thread
self.addEventListener('message', (event: MessageEvent) => {
  const { type, payload } = event.data;
  
  switch (type) {
    case 'SKIP_WAITING':
      (self as any).skipWaiting();
      break;
      
    case 'CACHE_URLS':
      cacheUrls(payload.urls);
      break;
      
    case 'CLEAR_CACHE':
      clearCache(payload.cacheName);
      break;
      
    case 'GET_CACHE_SIZE':
      getCacheSize().then(size => {
        event.ports[0]?.postMessage({ type: 'CACHE_SIZE', size });
      });
      break;
  }
});

// Helper functions
async function getPendingActions(): Promise<any[]> {
  // Implementation would read from IndexedDB
  return [];
}

async function syncAction(action: any): Promise<void> {
  // Implementation would sync the action with the server
  console.log('Syncing action:', action);
}

async function removePendingAction(actionId: string): Promise<void> {
  // Implementation would remove from IndexedDB
  console.log('Removing pending action:', actionId);
}

async function cacheUrls(urls: string[]): Promise<void> {
  const cache = await caches.open(DYNAMIC_CACHE);
  await cache.addAll(urls);
}

async function clearCache(cacheName?: string): Promise<void> {
  if (cacheName) {
    await caches.delete(cacheName);
  } else {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
  }
}

async function getCacheSize(): Promise<number> {
  const cacheNames = await caches.keys();
  let totalSize = 0;
  
  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) {
        const blob = await response.blob();
        totalSize += blob.size;
      }
    }
  }
  
  return totalSize;
}

// Periodic background sync (if supported)
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicSync', (event: any) => {
    if (event.tag === 'content-sync') {
      event.waitUntil(doPeriodicSync());
    }
  });
}

async function doPeriodicSync(): Promise<void> {
  try {
    // Sync critical data periodically
    console.log('Performing periodic sync');
    
    // Update cache with fresh data
    const criticalUrls = [
      '/api/health',
      '/api/auth/session',
    ];
    
    const cache = await caches.open(DYNAMIC_CACHE);
    
    for (const url of criticalUrls) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          await cache.put(url, response);
        }
      } catch (error) {
        console.error(`Failed to sync ${url}:`, error);
      }
    }
  } catch (error) {
    console.error('Periodic sync failed:', error);
  }
}

export {};
