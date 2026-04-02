/**
 * Static analysis script to audit Prisma queries for tenantId filters.
 *
 * Scans all tRPC router files (excluding calls.ts and webhook handlers)
 * and reports any Prisma query that may be missing a tenantId WHERE clause.
 *
 * Usage: npx tsx scripts/audit-tenant-filter.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const ROUTERS_DIR = path.resolve(__dirname, '../apps/api/src/trpc/routers');
const SKIP_FILES = new Set(['calls.ts', 'index.ts']);
const SKIP_DIRS = new Set(['__tests__']);

const QUERY_PATTERN = /prisma\.(\w+)\.(findMany|findFirst|findUnique|aggregate|count|groupBy)\(/g;
const TENANT_ID_PATTERN = /tenantId/;

type Finding = {
  file: string;
  line: number;
  query: string;
  hasTenantId: boolean;
};

function scanFile(filePath: string): Finding[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const findings: Finding[] = [];
  const relativePath = path.relative(process.cwd(), filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const matches = [...line.matchAll(QUERY_PATTERN)];

    for (const match of matches) {
      const model = match[1];
      const method = match[2];
      const queryDesc = `prisma.${model}.${method}()`;

      // Look at the surrounding context (current line + next 15 lines) for tenantId
      const contextEnd = Math.min(i + 15, lines.length);
      const context = lines.slice(i, contextEnd).join('\n');
      const hasTenantId = TENANT_ID_PATTERN.test(context);

      findings.push({
        file: relativePath,
        line: i + 1,
        query: queryDesc,
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

function main() {
  console.log('Tenant Filter Audit');
  console.log('='.repeat(60));
  console.log(`Scanning: ${ROUTERS_DIR}`);
  console.log(`Skipping: ${[...SKIP_FILES].join(', ')}`);
  console.log('');

  const files = walkDir(ROUTERS_DIR);
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

  if (missing.length > 0) {
    console.log('QUERIES MISSING tenantId FILTER:');
    console.log('-'.repeat(60));
    for (const finding of missing) {
      console.log(`  ${finding.file}:${finding.line} - ${finding.query}`);
    }
    console.log('');
    console.log('These queries may need a tenantId filter in their WHERE clause.');
    console.log('Review each one to confirm whether tenant isolation is needed.');
    process.exit(1);
  } else {
    console.log('All Prisma queries have tenantId filters within 15 lines of context.');
    process.exit(0);
  }
}

main();
