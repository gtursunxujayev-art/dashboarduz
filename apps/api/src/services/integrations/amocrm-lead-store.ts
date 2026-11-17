// Writes amoCRM leads into the `leads` table without relying on the (tenantId, amocrmId) unique
// index. Production was never migrated with `prisma migrate deploy`, and its `leads` table has no such
// index, so `upsert` (INSERT … ON CONFLICT) fails there with "no unique or exclusion constraint
// matching the ON CONFLICT specification". Looking rows up first works with or without the index.
import { type DbClient } from '@dashboarduz/db';
import type { Prisma } from '@prisma/client';

export type LeadWrite = {
  amocrmId: string;
  /** Fields to set on an existing row (every row with this amoCRM id, should duplicates exist). */
  update: Prisma.LeadUpdateManyMutationInput;
  /** Full row for a lead not stored yet (tenantId and amocrmId are added). */
  create: Omit<Prisma.LeadCreateManyInput, 'tenantId' | 'amocrmId'>;
};

/** Updates stored leads and inserts new ones, in one transaction. */
export async function writeLeadsByAmoId(
  tenantId: string,
  writes: LeadWrite[],
  db: DbClient,
): Promise<{ created: number; updated: number }> {
  // The last write for an id wins, as consecutive upserts would.
  const byId = new Map<string, LeadWrite>();

  for (const write of writes) byId.set(write.amocrmId, write);
  if (!byId.size) return { created: 0, updated: 0 };

  const existing = await db.lead.findMany({
    where: { tenantId, amocrmId: { in: Array.from(byId.keys()) } },
    select: { amocrmId: true },
  });
  const existingIds = new Set(existing.map((row) => row.amocrmId).filter((id): id is string => Boolean(id)));
  const updates = Array.from(byId.values()).filter((write) => existingIds.has(write.amocrmId));
  const creates = Array.from(byId.values())
    .filter((write) => !existingIds.has(write.amocrmId))
    .map((write) => ({ ...write.create, tenantId, amocrmId: write.amocrmId }));

  const run = async (client: DbClient) => {
    for (const write of updates) {
      await client.lead.updateMany({ where: { tenantId, amocrmId: write.amocrmId }, data: write.update });
    }
    if (creates.length) await client.lead.createMany({ data: creates });
  };

  if ('$transaction' in db) {
    await db.$transaction(async (tx) => run(tx));
  } else {
    await run(db);
  }

  return { created: creates.length, updated: updates.length };
}

/**
 * Keeps one row per amoCRM id (the most recently updated in amoCRM). Without the unique index a
 * lead can have been stored twice; reads must not count it twice.
 */
export function dedupeByAmoId<T extends { amocrmId: string | null; externalUpdatedAt: Date | null }>(rows: T[]): T[] {
  const seen = new Map<string, number>();
  const result: T[] = [];

  for (const row of rows) {
    if (!row.amocrmId) {
      result.push(row);
      continue;
    }
    const index = seen.get(row.amocrmId);

    if (index === undefined) {
      seen.set(row.amocrmId, result.length);
      result.push(row);
      continue;
    }
    const kept = result[index];

    if ((row.externalUpdatedAt?.getTime() ?? 0) > (kept?.externalUpdatedAt?.getTime() ?? 0)) {
      result[index] = row;
    }
  }

  return result;
}
