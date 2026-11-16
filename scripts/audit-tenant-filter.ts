/**
 * Static analysis script to audit Prisma queries for tenantId filters.
 *
 * Scans all tRPC router files (excluding calls.ts and webhook handlers), plus the service folders that hold
 * query code moved out of those routers (SERVICE_DIRS), so moving a query out of a router keeps it in the audit.
 * and reports any Prisma query that may be missing a tenantId WHERE clause.
 *
 * Usage:
 *   npx tsx scripts/audit-tenant-filter.ts                      # report; exit 1 on any finding
 *   npx tsx scripts/audit-tenant-filter.ts --baseline           # CI: exit 1 only on findings not in the baseline
 *   npx tsx scripts/audit-tenant-filter.ts --update-baseline    # record current findings as the baseline
 *
 * The baseline (scripts/audit-tenant-filter.baseline.json) counts findings per file and `model.method`, so it does
 * not break when lines move or when the query receiver changes (prisma.x / systemPrisma.x / ctx.db.x / tx.x). It
 * lists queries that were already unfiltered when it was written; each still needs a review, and fixing one lets the baseline shrink.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROUTERS_DIR = path.resolve(REPO_ROOT, 'apps/api/src/trpc/routers');
// Services that took over query code from routers when the routers were split into folders.
const SERVICE_DIRS = ['customer-income', 'sellers', 'integration-settings', 'course-sales', 'income-debug', 'bonus-config', 'dashboard'].map((dir) => path.resolve(REPO_ROOT, 'apps/api/src/services', dir));
const SCAN_DIRS = [ROUTERS_DIR, ...SERVICE_DIRS];
const BASELINE_PATH = path.resolve(__dirname, 'audit-tenant-filter.baseline.json');
const SKIP_FILES = new Set(['calls.ts', 'index.ts']);
const SKIP_DIRS = new Set(['__tests__']);

// Matches `prisma.model.method(`, `systemPrisma.model.method(`, `ctx.db.model.method(`, `db.model.method(` and
// `tx.model.method(`. Routers use the unscoped `systemPrisma` where no user is logged in yet (e.g. auth).
const QUERY_PATTERN = /\b(?:prisma|systemPrisma|db|tx)\.(\w+)\.(findMany|findFirst|findUnique|aggregate|count|groupBy)\(/g;
const TENANT_ID_PATTERN = /tenantId/;

type Finding = {
  file: string;
  line: number;
  query: string;
  key: string;
  hasTenantId: boolean;
};

type Baseline = Record<string, Record<string, number>>;

function scanFile(filePath: string): Finding[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const findings: Finding[] = [];
  const relativePath = path.relative(REPO_ROOT, filePath).split(path.sep).join('/');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const matches = [...line.matchAll(QUERY_PATTERN)];

    for (const match of matches) {
      const model = match[1];
      const method = match[2];
      const queryDesc = `${match[0].slice(0, -1)}()`;

      // Look at the surrounding context (current line + next 15 lines) for tenantId
      const contextEnd = Math.min(i + 15, lines.length);
      const context = lines.slice(i, contextEnd).join('\n');
      const hasTenantId = TENANT_ID_PATTERN.test(context);

      findings.push({
        file: relativePath,
        line: i + 1,
        query: queryDesc,
        key: `${model}.${method}`,
        hasTenantId,
      });
    }
  }

  return findings;
}

function walkDir(dir: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...walkDir(path.join(dir, entry.name)));
    } else if (entry.name.endsWith('.ts') && !SKIP_FILES.has(entry.name)) {
      files.push(path.join(dir, entry.name));
    }
  }

  return files;
}

function countByFileAndQuery(findings: Finding[]): Baseline {
  const counts: Baseline = {};
  for (const finding of [...findings].sort((a, b) => a.file.localeCompare(b.file) || a.key.localeCompare(b.key))) {
    const perFile = (counts[finding.file] ??= {});
    perFile[finding.key] = (perFile[finding.key] ?? 0) + 1;
  }

  return counts;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const useBaseline = args.has('--baseline');
  const updateBaseline = args.has('--update-baseline');

  console.log('Tenant Filter Audit');
  console.log('='.repeat(60));
  console.log(`Scanning: ${SCAN_DIRS.join(', ')}`);
  console.log(`Skipping: ${[...SKIP_FILES].join(', ')}`);
  console.log('');

  const files = SCAN_DIRS.flatMap((dir) => walkDir(dir));
  const allFindings: Finding[] = [];

  for (const file of files) {
    allFindings.push(...scanFile(file));
  }

  const missing = allFindings.filter((f) => !f.hasTenantId);
  const present = allFindings.filter((f) => f.hasTenantId);

  console.log(`Total queries found: ${allFindings.length}`);
  console.log(`With tenantId: ${present.length}`);
  console.log(`Missing tenantId: ${missing.length}`);
  console.log('');

  if (updateBaseline) {
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(countByFileAndQuery(missing), null, 2)}\n`);
    console.log(`Wrote ${path.relative(REPO_ROOT, BASELINE_PATH)} with ${missing.length} known finding(s).`);
    process.exit(0);
  }

  if (missing.length > 0) {
    console.log('QUERIES MISSING tenantId FILTER:');
    console.log('-'.repeat(60));
    for (const finding of missing) {
      console.log(`  ${finding.file}:${finding.line} - ${finding.query}`);
    }
    console.log('');
  }

  if (useBaseline) {
    const baseline: Baseline = fs.existsSync(BASELINE_PATH)
      ? (JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as Baseline)
      : {};
    const current = countByFileAndQuery(missing);
    const newFindings: string[] = [];
    for (const [file, queries] of Object.entries(current)) {
      for (const [key, count] of Object.entries(queries)) {
        const allowed = baseline[file]?.[key] ?? 0;
        if (count > allowed) newFindings.push(`  ${file} - ${key}: ${count} unfiltered (baseline ${allowed})`);
      }
    }

    if (newFindings.length > 0) {
      console.log('NEW queries missing a tenantId filter (not in the baseline):');
      console.log(newFindings.join('\n'));
      console.log('');
      console.log('Add a tenantId filter to the new query. If it is deliberately cross-tenant, review it and then run');
      console.log('  npx tsx scripts/audit-tenant-filter.ts --update-baseline');
      process.exit(1);
    }

    console.log(`No new findings (${missing.length} known, listed in ${path.relative(REPO_ROOT, BASELINE_PATH)}).`);
    process.exit(0);
  }

  if (missing.length > 0) {
    console.log('These queries may need a tenantId filter in their WHERE clause.');
    console.log('Review each one to confirm whether tenant isolation is needed.');
    process.exit(1);
  } else {
    console.log('All Prisma queries have tenantId filters within 15 lines of context.');
    process.exit(0);
  }
}

main();
