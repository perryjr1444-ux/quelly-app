# PoofPass 🚀
Disposable passwords made simple.

## Getting Started
1. Install deps:
   ```bash
   npm install
   ```

2. Copy `.env.example` → `.env.local` and fill in Supabase keys.

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
