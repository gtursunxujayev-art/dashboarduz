/** True for Prisma's unique-constraint violation (P2002), e.g. when a concurrent insert of the same key won. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
