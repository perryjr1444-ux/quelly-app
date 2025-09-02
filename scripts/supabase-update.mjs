#!/usr/bin/env node
import { execSync } from 'node:child_process';

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
}

const accessToken = process.env.SUPABASE_ACCESS_TOKEN || '';
const projectRef = process.env.SUPABASE_PROJECT_REF || '';

if (!accessToken || !projectRef) {
  console.error('Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF');
  process.exit(1);
}

try {
  run('supabase --version');
} catch {
  console.error('Supabase CLI not found. Install: npm i -g supabase');
  process.exit(1);
}

run(`supabase login --token ${accessToken}`);
run(`supabase link --project-ref ${projectRef}`);
run('supabase db push');

console.log('Supabase migrations pushed successfully.');


