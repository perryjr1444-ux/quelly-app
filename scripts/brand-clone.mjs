#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DEST = path.resolve(SRC_ROOT, '..', 'hashword-app');

const EXCLUDES = new Set([
  '.git',
  'node_modules',
  '.next',
  '.vercel',
  '.DS_Store',
  'dist',
]);

const REPLACEMENTS = [
  // Brand name cases
  { from: /PoofPass/g, to: 'Hashword' },
  { from: /poofpass/g, to: 'hashword' },
  { from: /POOFPASS/g, to: 'HASHWORD' },
  // Domains and emails
  { from: /support@poofpass\.com/g, to: 'support@hashword.com' },
  { from: /app\.poofpass\.com/g, to: 'app.hashword.com' },
  { from: /poofpass\.com/g, to: 'hashword.com' },
];

function shouldExclude(name) {
  return EXCLUDES.has(name) || name.startsWith('.git');
}

function renameBasename(basename) {
  let out = basename;
  out = out.replace(/PoofPass/g, 'Hashword').replace(/poofpass/g, 'hashword').replace(/POOFPASS/g, 'HASHWORD');
  return out;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyAndTransform(src, dest) {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    // Skip symlinks for safety
    return;
  }
  if (stat.isDirectory()) {
    const baseRenamed = renameBasename(path.basename(src));
    const destDir = path.join(path.dirname(dest), baseRenamed);
    ensureDir(destDir);
    for (const entry of fs.readdirSync(src)) {
      if (shouldExclude(entry)) continue;
      copyAndTransform(path.join(src, entry), path.join(destDir, entry));
    }
    return;
  }
  // File: rename and replace content
  const renamed = renameBasename(path.basename(src));
  const outPath = path.join(path.dirname(dest), renamed);
  let content = fs.readFileSync(src);
  // Attempt text replacement if looks like text (heuristic: small files or utf8 decodable)
  let asString;
  try {
    asString = content.toString('utf8');
  } catch {
    fs.writeFileSync(outPath, content);
    return;
  }
  let replaced = asString;
  for (const { from, to } of REPLACEMENTS) {
    replaced = replaced.replace(from, to);
  }
  fs.writeFileSync(outPath, replaced, 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  const destRoot = path.resolve(args[0] || DEFAULT_DEST);
  const dryRun = args.includes('--dry-run');

  if (dryRun) {
    console.log(`[DRY RUN] Would clone ${SRC_ROOT} -> ${destRoot}`);
    return;
  }

  if (fs.existsSync(destRoot)) {
    console.error(`Destination already exists: ${destRoot}`);
    process.exit(1);
  }
  ensureDir(destRoot);
  for (const entry of fs.readdirSync(SRC_ROOT)) {
    if (shouldExclude(entry)) continue;
    const srcPath = path.join(SRC_ROOT, entry);
    copyAndTransform(srcPath, path.join(destRoot, entry));
  }
  console.log(`Cloned with brand replacements -> ${destRoot}`);
}

main();


