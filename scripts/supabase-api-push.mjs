#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const token = process.env.SUPABASE_DASHBOARD_TOKEN || process.env.SUPABASE_ACCESS_TOKEN || '';
const projectRef = process.env.SUPABASE_PROJECT_REF || '';
const base = process.env.SUPABASE_API_BASE || 'https://api.supabase.com/api/v0';
const migrationsDir = path.resolve(__dirname, '../supabase/migrations');

if (!token || !projectRef) {
  console.error('Missing SUPABASE_DASHBOARD_TOKEN (or SUPABASE_ACCESS_TOKEN) or SUPABASE_PROJECT_REF');
  process.exit(1);
}

function readMigrations(dir) {
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  return files.map(f => ({ name: f, sql: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

async function tryEndpoint(url, sql) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json().catch(() => ({}));
}

async function execSql(sql) {
  // Try a few known/likely endpoints; first one that works will be used
  const candidates = [
    `${base}/projects/${projectRef}/db/execute`,
    `${base}/projects/${projectRef}/sql`,
    `${base}/projects/${projectRef}/database/query`,
  ];
  let lastErr;
  for (const url of candidates) {
    try {
      return await tryEndpoint(url, sql);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No working SQL endpoint found');
}

async function main() {
  const migrations = readMigrations(migrationsDir);
  console.log(`Found ${migrations.length} migrations`);
  for (const m of migrations) {
    const label = m.name;
    const sql = m.sql.trim();
    if (!sql) continue;
    console.log(`\n--- Applying ${label} ---`);
    try {
      await execSql(sql);
      console.log(`Applied: ${label}`);
    } catch (err) {
      console.error(`Failed: ${label}`);
      console.error(String(err));
      process.exit(1);
    }
  }
  console.log('\nAll migrations applied via Management API.');
}

main();


