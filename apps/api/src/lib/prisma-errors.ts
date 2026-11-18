/** True for Prisma's unique-constraint violation (P2002), e.g. when a concurrent insert of the same key won. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

/** True for Prisma's foreign-key violation (P2003), e.g. a delete the database refuses because rows still point at it. */
export function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2003';
}
