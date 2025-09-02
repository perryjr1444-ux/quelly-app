# Environment Configuration Guide

## Required Environment Variables

### Core Configuration

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# Security Keys (generate with: openssl rand -base64 32)
VAULT_KEK=your-key-encryption-key-base64
VAULT_POINTER_PEPPER=your-pointer-pepper-base64
OTAC_PEPPER=your-otac-pepper-base64
ADMIN_BOOTSTRAP_SECRET=your-secure-admin-secret
```

### Billing Configuration

```bash
# Stripe
STRIPE_SECRET_KEY=sk_test_your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=whsec_your-webhook-secret
STRIPE_PRICE_ID=price_your-stripe-price-id

# Payment Settings
PAYMENTS_PROVIDER=stripe
CREDITS_PACKAGE_QUANTITY=100
CREDITS_PRICE_USD=9
```

### Monitoring

```bash
# Sentry
NEXT_PUBLIC_SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
SENTRY_AUTH_TOKEN=your-auth-token

# PostHog
NEXT_PUBLIC_POSTHOG_KEY=phc_your-posthog-key
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

### Application Settings

```bash
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPPORT_EMAIL=support@poofpass.com
OTAC_TTL_SECONDS=90
# Internal function auth (used by edge functions)
INTERNAL_FUNCTION_SECRET=generate-a-strong-random
```

## Security Best Practices

1. **Never commit secrets**: Use `.env.local` for local development
2. **Use strong secrets**: Generate with `openssl rand -base64 32`
3. **Rotate regularly**: Set up key rotation policies
4. **Environment separation**: Use different keys for dev/staging/prod
5. **Secure storage**: Use a secrets manager in production

## Key Generation Commands

```bash
# Generate encryption keys
openssl rand -base64 32  # For VAULT_KEK
openssl rand -base64 32  # For VAULT_POINTER_PEPPER
openssl rand -base64 32  # For OTAC_PEPPER

# Generate admin secret
openssl rand -hex 32     # For ADMIN_BOOTSTRAP_SECRET
```
