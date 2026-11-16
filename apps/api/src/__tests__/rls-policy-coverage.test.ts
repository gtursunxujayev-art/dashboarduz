import fs from 'fs';
import path from 'path';

/**
 * Static check: every Prisma model with a `tenantId` column must have Row Level
 * Security enabled and a tenant isolation policy (USING + WITH CHECK on
 * app.current_tenant_id()) in the migration history. Adding a tenant table
 * without a policy migration fails this test.
 */

const prismaDir = path.resolve(__dirname, '../../../../packages/db/prisma');

type PolicyState = Map<string, string>; // policy name -> CREATE POLICY statement

function loadModels(): Array<{ model: string; table: string; hasTenantId: boolean }> {
  const schema = fs.readFileSync(path.join(prismaDir, 'schema.prisma'), 'utf8');
  const models: Array<{ model: string; table: string; hasTenantId: boolean }> = [];
  const modelRe = /^model (\w+) \{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;

  while ((match = modelRe.exec(schema))) {
    const model = match[1] ?? '';
    const body = match[2] ?? '';
    const map = /@@map\("(\w+)"\)/.exec(body);

    models.push({ model, table: map?.[1] ?? model, hasTenantId: /^\s+tenantId\s/m.test(body) });
  }

  return models;
}

function loadPolicyState(): { policies: Map<string, PolicyState>; rlsEnabled: Set<string> } {
  const migrationsDir = path.join(prismaDir, 'migrations');
  const dirs = fs.readdirSync(migrationsDir).filter((d) => fs.existsSync(path.join(migrationsDir, d, 'migration.sql'))).sort();
  const policies = new Map<string, PolicyState>();
  const rlsEnabled = new Set<string>();
  const statementRe = /(CREATE POLICY|DROP POLICY IF EXISTS|DROP POLICY)\s+"?(\w+)"?\s+ON\s+"?(\w+)"?([^;]*);|ALTER TABLE\s+"?(\w+)"?\s+(ENABLE|DISABLE) ROW LEVEL SECURITY/g;

  for (const dir of dirs) {
    const sql = fs.readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8');
    let m: RegExpExecArray | null;

    while ((m = statementRe.exec(sql))) {
      if (m[1]) {
        const kind = m[1];
        const name = m[2] ?? '';
        const table = m[3] ?? '';
        const rest = m[4] ?? '';
        const state = policies.get(table) ?? new Map<string, string>();

        if (kind === 'CREATE POLICY') state.set(name, rest);
        else state.delete(name);
        policies.set(table, state);
      } else if (m[6] === 'ENABLE') {
        rlsEnabled.add(m[5] ?? '');
      } else {
        rlsEnabled.delete(m[5] ?? '');
      }
    }
  }

  return { policies, rlsEnabled };
}

describe('RLS policy coverage', () => {
  const models = loadModels();
  const { policies, rlsEnabled } = loadPolicyState();

  it('finds the schema and migrations', () => {
    expect(models.length).toBeGreaterThan(20);
    expect(policies.size).toBeGreaterThan(20);
  });

  it.each(models.filter((m) => m.hasTenantId).map((m) => [m.model, m.table]))(
    '%s (%s) has RLS enabled and a tenant isolation policy with WITH CHECK',
    (_model, table) => {
      expect(rlsEnabled.has(table)).toBe(true);
      const tablePolicies = [...(policies.get(table)?.values() ?? [])];
      const isolating = tablePolicies.filter((text) => (
        /USING\s*\([\s\S]*"tenantId"[\s\S]*app\.current_tenant_id\(\)/.test(text)
        && /WITH CHECK\s*\([\s\S]*"tenantId"[\s\S]*app\.current_tenant_id\(\)/.test(text)
      ));

      expect(isolating.length).toBeGreaterThanOrEqual(1);
    },
  );

  it.each(['tenants', 'user_auth_links'])('%s has RLS enabled and a policy', (table) => {
    expect(rlsEnabled.has(table)).toBe(true);
    const tablePolicies = [...(policies.get(table)?.values() ?? [])];

    expect(tablePolicies.some((text) => /WITH CHECK/.test(text))).toBe(true);
  });
});
