# PoofPass - The Revolutionary Unhackable Password System 🚀

**THE CORE REVOLUTIONARY CONCEPT**: Passwords that automatically rotate after each login attempt, making them truly unhackable by design.

## 🚀 The Revolutionary Concept

PoofPass doesn't just store passwords - it makes them **obsolete and unhackable** by:

- **🔄 Automatic Rotation**: Passwords automatically rotate after each login attempt (success or failure)
- **🛡️ Unhackable by Design**: Even if a password is stolen, it becomes useless after the next login
- **⚡ Single-Use Tokens**: Each login gets a fresh, unique password
- **🚫 Zero Credential Reuse**: Eliminates credential reuse attacks by design
- **🎯 Login Detection**: Automatically detects when passwords are used and triggers rotation

## Features

- **🔄 Auto-Rotating Passwords**: The core revolutionary feature that makes passwords unhackable
- **🛡️ Zero-Trust Architecture**: End-to-end encryption with client-side key management
- **⚡ Real-time Updates**: WebSocket-based real-time synchronization
- **👥 Team Collaboration**: Share passwords securely with team members
- **📊 Audit Logging**: Comprehensive logging of all password operations
- **📱 Progressive Web App**: Offline-capable with service worker
- **🔐 Military-Grade Security**: AES-256-GCM encryption, WebAuthn, and advanced session security

## Getting Started
1. Install deps:
   ```bash
   npm install
   ```

2. Copy `.env.example` → `.env.local` and fill in Supabase keys.
   - Supports either `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` for anon key.

3. Run dev:
   ```bash
   npm run dev
   ```

## Database (Supabase)

1. Create a Supabase project and grab your `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
2. Copy `.env.example` → `.env.local` and fill in values. Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
3. Apply the schema migration:
   - If using Supabase SQL editor, open and run: `supabase/migrations/2025-08-26_poofpass.sql`.
   - If using the CLI, run:
     ```bash
     supabase db push
     ```

## Tech

- Next.js (App Router, TS)
- TailwindCSS
- shadcn/ui
- Supabase (Auth, DB)
- Framer Motion
