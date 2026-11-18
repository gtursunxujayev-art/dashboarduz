/** Value comparison and scalar `where` filters for InMemoryPrisma (see in-memory-prisma.ts). */
import { Prisma } from '@prisma/client';

export type Row = Record<string, unknown>;
export type DmmfField = Prisma.DMMF.Field;
export type DmmfModel = Prisma.DMMF.Model;

export function isRecord(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date) && !Prisma.Decimal.isDecimal(value);
}

export function unsupported(what: string): never {
  throw new Error(`in-memory prisma: unsupported ${what}`);
}

export function fieldOf(model: DmmfModel, name: string): DmmfField | undefined {
  return model.fields.find((field) => field.name === name);
}

export function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (Prisma.Decimal.isDecimal(value)) return value.toNumber();

  return value;
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  if (left instanceof Date || right instanceof Date) {
    if (left === null || left === undefined || right === null || right === undefined) return false;

    return new Date(left as Date).getTime() === new Date(right as Date).getTime();
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => valuesEqual(item, right[index]));
  }

  return comparable(left) === comparable(right);
}

export function compareValues(left: unknown, right: unknown): number {
  const a = comparable(left);
  const b = comparable(right);

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);

  return unsupported(`comparison of ${typeof a} and ${typeof b}`);
}

export function cloneValue(value: unknown): unknown {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));

  return value;
}

function textMatches(value: unknown, needle: unknown, insensitive: boolean, test: (haystack: string, probe: string) => boolean): boolean {
  if (typeof value !== 'string' || typeof needle !== 'string') return false;

  return insensitive ? test(value.toLowerCase(), needle.toLowerCase()) : test(value, needle);
}

export function matchesScalarFilter(value: unknown, filter: unknown, field: DmmfField): boolean {
  if (!isRecord(filter)) {
    return field.isList && Array.isArray(filter) ? valuesEqual(value, filter) : (filter === null ? value === null || value === undefined : valuesEqual(value, filter));
  }
  const insensitive = filter.mode === 'insensitive';

  return Object.entries(filter).every(([operator, operand]) => {
    if (operand === undefined || operator === 'mode') return true;
    switch (operator) {
      case 'equals':
        return operand === null ? value === null || value === undefined : valuesEqual(value, operand);
      case 'not':
        return !matchesScalarFilter(value, operand, field);
      case 'in':
        return Array.isArray(operand) && operand.some((candidate) => valuesEqual(value, candidate));
      case 'notIn':
        return Array.isArray(operand) && !operand.some((candidate) => valuesEqual(value, candidate));
      case 'lt':
        return value !== null && value !== undefined && compareValues(value, operand) < 0;
      case 'lte':
        return value !== null && value !== undefined && compareValues(value, operand) <= 0;
      case 'gt':
        return value !== null && value !== undefined && compareValues(value, operand) > 0;
      case 'gte':
        return value !== null && value !== undefined && compareValues(value, operand) >= 0;
      case 'contains':
        return textMatches(value, operand, insensitive, (haystack, probe) => haystack.includes(probe));
      case 'startsWith':
        return textMatches(value, operand, insensitive, (haystack, probe) => haystack.startsWith(probe));
      case 'endsWith':
        return textMatches(value, operand, insensitive, (haystack, probe) => haystack.endsWith(probe));
      case 'has':
        return Array.isArray(value) && value.some((item) => valuesEqual(item, operand));
      case 'hasSome':
        return Array.isArray(value) && Array.isArray(operand) && operand.some((item) => value.some((own) => valuesEqual(own, item)));
      case 'hasEvery':
        return Array.isArray(value) && Array.isArray(operand) && operand.every((item) => value.some((own) => valuesEqual(own, item)));
      case 'isEmpty':
        return Array.isArray(value) && (value.length === 0) === operand;
      default:
        return unsupported(`filter operator "${operator}" on ${field.name}`);
    }
  });
}
