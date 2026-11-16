#!/usr/bin/env node
/**
 * Duplicate-helper guard.
 *
 * Lists every top-level function name that is defined in more than one
 * non-test source file of the same scope (apps/api/src, apps/web/src,
 * packages/shared/src), or in more than one of those scopes, and fails when a
 * name appears that is not in the allowlists below. Shared helpers live in
 * apps/api/src/lib, apps/web/src/lib (and components) and packages/shared.
 * Top-level means a declaration that starts at column 0:
 *
 *   function foo(       async function foo(       export function foo(
 *   const foo = (       const foo = async (       export const foo = <T>(
 *   const foo = function
 *
 * `export default function` (Next.js pages/layouts) is ignored because the
 * framework, not the author, decides that those exist once per route.
 *
 * Usage:
 *   node scripts/check-duplicate-functions.mjs           # fail on new duplicates
 *   node scripts/check-duplicate-functions.mjs --report  # print every duplicate, never fail
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const SCOPES = ['apps/api/src', 'apps/web/src', 'packages/shared/src'];

/**
 * Names that are deliberately defined more than once. Each entry needs a reason.
 * Keyed by scope, then function name.
 */
const ALLOWED = {
  'apps/api/src': {},
  'apps/web/src': {},
  'packages/shared/src': {},
};

/** Names defined in more than one scope on purpose: same name, different function. */
const CROSS_SCOPE_ALLOWED = {
  normalizeTextToken: 'API trims and lower-cases (`||`); the web income page only trims (`??`)',
  resolveUserLabel: 'different fallbacks: API income debug falls back to a fixed label, the web Telegram bot page to email/phone',
  normalizeBaseUrl: 'API returns null for an empty URL; the web tRPC client defaults to localhost',
};

const DECLARATION =
  /^(?:export\s+)?(?:(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:<[^>]*>\s*)?\([^)]*\)?\s*(?::[^=]*)?=>|(?:<[^>]*>\s*)?\(|[A-Za-z_$][\w$]*\s*=>))/;

function isTestFile(path) {
  return (
    path.includes(`${sep}__tests__${sep}`) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
    path.includes(`${sep}__mocks__${sep}`)
  );
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (/\.[cm]?[jt]sx?$/.test(entry) && !entry.endsWith('.d.ts') && !isTestFile(full)) out.push(full);
  }
  return out;
}

function collect(scope) {
  const byName = new Map();
  for (const file of walk(join(ROOT, scope), [])) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.startsWith('export default')) return;
      const match = DECLARATION.exec(line);
      if (!match) return;
      const name = match[1] ?? match[2];
      const where = `${relative(ROOT, file).split(sep).join('/')}:${index + 1}`;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(where);
    });
  }
  return byName;
}

function scan(byName) {
  const duplicates = [];
  for (const [name, places] of byName) {
    const files = new Set(places.map((p) => p.replace(/:\d+$/, '')));
    if (files.size > 1) duplicates.push({ name, places });
  }
  duplicates.sort((a, b) => b.places.length - a.places.length || a.name.localeCompare(b.name));
  return duplicates;
}

const reportOnly = process.argv.includes('--report');
let failed = false;
const scopes = new Map(SCOPES.map((scope) => [scope, collect(scope)]));
for (const [scope, byName] of scopes) {
  const duplicates = scan(byName);
  const allowed = ALLOWED[scope] ?? {};
  const unexpected = duplicates.filter((d) => !(d.name in allowed));
  console.log(`\n${scope}: ${duplicates.length} duplicated top-level function name(s), ${unexpected.length} not allowlisted`);
  for (const d of reportOnly ? duplicates : unexpected) {
    console.log(`  ${d.name} x${d.places.length}${d.name in allowed ? ` (allowed: ${allowed[d.name]})` : ''}`);
    for (const p of d.places) console.log(`    ${p}`);
  }
  if (unexpected.length > 0) failed = true;
}

const crossScope = new Map();
for (const [scope, byName] of scopes) {
  for (const [name, places] of byName) {
    if (!crossScope.has(name)) crossScope.set(name, new Map());
    crossScope.get(name).set(scope, places);
  }
}
const crossDuplicates = [...crossScope].filter(([, perScope]) => perScope.size > 1);
const crossUnexpected = crossDuplicates.filter(([name]) => !(name in CROSS_SCOPE_ALLOWED));
console.log(`
across scopes: ${crossDuplicates.length} name(s) defined in more than one scope, ${crossUnexpected.length} not allowlisted`);
for (const [name, perScope] of reportOnly ? crossDuplicates : crossUnexpected) {
  console.log(`  ${name}${name in CROSS_SCOPE_ALLOWED ? ` (allowed: ${CROSS_SCOPE_ALLOWED[name]})` : ''}`);
  for (const places of perScope.values()) for (const p of places) console.log(`    ${p}`);
}
if (crossUnexpected.length > 0) failed = true;

if (failed && !reportOnly) {
  console.error(
    '\nA helper is defined in more than one file. Import the shared one instead ' +
      '(apps/api/src/lib, apps/web/src/lib, packages/shared), or add it to ALLOWED / CROSS_SCOPE_ALLOWED in ' +
      'scripts/check-duplicate-functions.mjs with the reason.',
  );
  process.exit(1);
}
