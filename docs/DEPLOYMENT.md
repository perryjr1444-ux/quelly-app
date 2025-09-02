# PoofPass Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Database Setup](#database-setup)
4. [Application Deployment](#application-deployment)
5. [Security Configuration](#security-configuration)
6. [Monitoring Setup](#monitoring-setup)
7. [Production Checklist](#production-checklist)
8. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Services
- **Supabase** account for database and authentication
- **Vercel** account (recommended) or any Node.js hosting
- **Stripe** account for payments
- **Sentry** account for error tracking
- **Cloudflare** (optional) for CDN and DDoS protection
- **Datadog/Prometheus** (optional) for metrics

### Required Tools
- Node.js 18.x or later
- npm or yarn
- Supabase CLI
- Git

## Environment Setup

### 1. Clone the Repository
```bash
git clone https://github.com/your-org/poofpass-app.git
cd poofpass-app
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Variables
Copy the environment template and fill in your values:

```bash
cp docs/ENVIRONMENT_SETUP.md .env.local
```

### Critical Environment Variables:
```env
# Supabase (Required)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Security Keys (Required - Generate with: openssl rand -base64 32)
VAULT_KEK=your-key-encryption-key
VAULT_POINTER_PEPPER=your-pointer-pepper
OTAC_PEPPER=your-otac-pepper
ADMIN_BOOTSTRAP_SECRET=your-admin-secret

# Stripe (Required for billing)
STRIPE_SECRET_KEY=sk_live_your-key
STRIPE_WEBHOOK_SECRET=whsec_your-secret
STRIPE_PRICE_ID=price_your-price-id

# Sentry (Recommended)
SENTRY_DSN=https://your-dsn@sentry.io/project-id
SENTRY_AUTH_TOKEN=your-auth-token
```

## Database Setup

### 1. Create Supabase Project
1. Go to [app.supabase.com](https://app.supabase.com)
2. Create a new project
3. Note your project URL and keys

### 2. Run Migrations
Apply all database migrations in order:

```bash
# Using Supabase CLI
supabase db push

# Or manually in SQL editor:
# Run each file in supabase/migrations/ in order
```

### 3. Deploy Edge Functions
```bash
npm run supabase:functions:deploy
```

### 4. Configure Database Security
1. Enable Row Level Security (RLS) on all tables
2. Verify security policies are active
3. Set up database backups in Supabase dashboard

## Application Deployment

### Option 1: Vercel (Recommended)

#### 1. Install Vercel CLI
```bash
npm i -g vercel
```

#### 2. Deploy
```bash
vercel --prod
```

#### 3. Configure Environment Variables
In Vercel dashboard:
1. Go to Project Settings > Environment Variables
2. Add all required environment variables
3. Set appropriate scopes (Production, Preview, Development)

#### 4. Configure Domains
1. Add your custom domain in Vercel dashboard
2. Configure DNS records as instructed

### Option 2: Docker

#### 1. Build Docker Image
```bash
docker build -t poofpass:latest .
```

#### 2. Run Container
```bash
docker run -p 3000:3000 \
  --env-file .env.production \
  poofpass:latest
```

### Option 3: Traditional VPS

#### 1. Setup Node.js
```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 2. Install PM2
```bash
npm install -g pm2
```

#### 3. Build and Start
```bash
npm run build
pm2 start npm --name poofpass -- start
pm2 save
pm2 startup
```

## Security Configuration

### 1. HTTPS/TLS
- **Vercel**: Automatic HTTPS
- **Self-hosted**: Use Let's Encrypt with Certbot
- **Cloudflare**: Enable Full (Strict) SSL/TLS

### 2. Security Headers
Headers are automatically configured in middleware.ts:
- Strict-Transport-Security
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- Content-Security-Policy

### 3. Rate Limiting
Configure rate limits in environment:
```env
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=20
```

### 4. Secrets Management
- Use environment variables for all secrets
- Never commit .env files
- Rotate keys regularly
- Use secret management services in production:
  - AWS Secrets Manager
  - HashiCorp Vault
  - Azure Key Vault

### 5. 2FA Setup
Enable 2FA for all admin accounts:
1. Navigate to /dashboard
2. Go to Security settings
3. Enable 2FA
4. Save backup codes securely

## Monitoring Setup

### 1. Error Tracking (Sentry)
```bash
# Configure Sentry
SENTRY_DSN=your-dsn
SENTRY_AUTH_TOKEN=your-token
SENTRY_ORG=your-org
SENTRY_PROJECT=your-project
```

### 2. Application Monitoring
Configure Datadog or Prometheus:
```env
DATADOG_API_KEY=your-api-key
DATADOG_APP_KEY=your-app-key
```

### 3. Health Checks
- Health endpoint: `/api/health`
- Metrics endpoint: `/api/monitoring/metrics` (admin only)

### 4. Logging
Configure structured logging:
```bash
# Production logs
pm2 logs poofpass
```

### 5. Alerting
Set up alerts for:
- Error rate > 1%
- Response time > 1s
- Database connection failures
- Payment failures
- Security events

## Production Checklist

### Pre-deployment
- [ ] All environment variables configured
- [ ] Database migrations applied
- [ ] Edge functions deployed
- [ ] SSL/TLS configured
- [ ] Security headers verified
- [ ] Rate limiting configured
- [ ] Backup strategy in place

### Testing
- [ ] Run full test suite: `npm test`
- [ ] Perform security scan: `npm audit`
- [ ] Load testing completed
- [ ] Penetration testing performed

### Monitoring
- [ ] Error tracking configured
- [ ] Metrics collection active
- [ ] Health checks passing
- [ ] Alerts configured
- [ ] Logging enabled

### Security
- [ ] Secrets rotated
- [ ] 2FA enabled for admins
- [ ] Security policies reviewed
- [ ] GDPR compliance verified
- [ ] Incident response plan ready

### Performance
- [ ] CDN configured
- [ ] Caching headers set
- [ ] Database indexes optimized
- [ ] Static assets optimized

## Troubleshooting

### Common Issues

#### Database Connection Errors
```bash
# Check Supabase status
curl https://status.supabase.com/api/v2/status.json

# Verify connection string
echo $NEXT_PUBLIC_SUPABASE_URL
```

#### Authentication Issues
1. Verify Supabase JWT secret
2. Check cookie settings
3. Verify redirect URLs in Supabase dashboard

#### Performance Issues
1. Check database query performance
2. Review caching configuration
3. Monitor memory usage: `pm2 monit`

#### Payment Issues
1. Verify Stripe webhook endpoint
2. Check webhook signing secret
3. Review Stripe logs

### Debug Mode
Enable debug logging:
```env
DEBUG=true
LOG_LEVEL=debug
```

### Support

For production support:
- Email: support@poofpass.com
- Documentation: https://docs.poofpass.com
- Status Page: https://status.poofpass.com

## Maintenance

### Regular Tasks
- **Daily**: Check health endpoints
- **Weekly**: Review error logs
- **Monthly**: Rotate secrets, review metrics
- **Quarterly**: Security audit, dependency updates

### Updating
```bash
# Pull latest changes
git pull origin main

# Install dependencies
npm install

# Run migrations
supabase db push

# Build and deploy
npm run build
vercel --prod
```

### Backup and Recovery
1. **Database**: Automatic via Supabase
2. **Secrets**: Backup in secure vault
3. **Code**: Git repository
4. **Recovery Time Objective (RTO)**: < 1 hour
5. **Recovery Point Objective (RPO)**: < 15 minutes
