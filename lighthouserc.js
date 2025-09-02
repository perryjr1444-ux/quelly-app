module.exports = {
  ci: {
    collect: {
      startServerCommand: 'npm run start',
      startServerReadyPattern: 'ready on',
      url: [
        'http://localhost:3000/',
        'http://localhost:3000/login',
        'http://localhost:3000/dashboard',
        'http://localhost:3000/pricing',
        'http://localhost:3000/api-docs',
      ],
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        throttling: {
          cpuSlowdownMultiplier: 1,
        },
      },
    },
    assert: {
      preset: 'lighthouse:recommended',
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 0.9 }],
        'categories:pwa': ['warn', { minScore: 0.8 }],
        
        // Specific metrics
        'first-contentful-paint': ['error', { maxNumericValue: 1500 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 300 }],
        'speed-index': ['error', { maxNumericValue: 3000 }],
        
        // Security headers
        'content-security-policy': 'error',
        'strict-transport-security': 'error',
        'x-frame-options': 'error',
        'x-content-type-options': 'error',
        
        // Best practices
        'no-vulnerable-libraries': 'error',
        'js-libraries': 'warn',
        'image-aspect-ratio': 'warn',
        'image-size-responsive': 'warn',
        
        // Accessibility
        'color-contrast': 'error',
        'heading-order': 'error',
        'link-name': 'error',
        'meta-viewport': 'error',
      },
    },
    upload: {
      target: 'temporary-public-storage',
      reportFilenamePattern: '{{url}}-{{fetchTime}}-report.{{extension}}',
    },
  },
};
