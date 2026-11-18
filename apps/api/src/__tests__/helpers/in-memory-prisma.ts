/**
 * A small in-memory stand-in for the Prisma client, for unit tests that exercise money code without a database.
 *
 * The model metadata (fields, defaults, relations, unique keys) comes from the generated client (`Prisma.dmmf`), so
 * relation selects (`select: { income: { select: ... } }`), relation filters (`{ income: { managerUserId } }`),
 * compound unique keys (`tenantId_month`) and defaults (`@default(uuid())`, `@default(now())`, `@updatedAt`) behave
 * as they do against Postgres. It supports the subset of the client API the API code uses: find*, count, aggregate,
 * groupBy, create/createMany, update/updateMany, upsert, delete/deleteMany, interactive and batch `$transaction`
 * (a failing interactive transaction rolls back), and `$queryRaw` through a pluggable handler (the default answers
 * the sale-chain row lock). Anything else throws "unsupported", so a test never passes on a silently ignored filter.
 *
 * It is not a database: no RLS, no foreign keys, no concurrency. Flows whose value is in those belong in the
 * integration tests (`describeWithDatabase`).
 */
import { randomUUID } from 'crypto';

import type { TenantPrismaClient } from '@dashboarduz/db';
import { Prisma } from '@prisma/client';

import { cloneValue, comparable, compareValues, type DmmfField, type DmmfModel, fieldOf, isRecord, matchesScalarFilter, type Row, unsupported, valuesEqual } from './in-memory-prisma-filters';

export class InMemoryPrismaError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'InMemoryPrismaError';
  }
}

export type RawQueryHandler = (sql: string, values: unknown[], db: InMemoryPrisma) => unknown;

export type RawQueryCall = { sql: string; values: unknown[] };

const models: DmmfModel[] = [...Prisma.dmmf.datamodel.models];
const modelByName = new Map(models.map((model) => [model.name, model]));
const modelByDelegate = new Map(models.map((model) => [model.name.charAt(0).toLowerCase() + model.name.slice(1), model]));

export class InMemoryPrisma {
  readonly tables = new Map<string, Row[]>();
  readonly rawQueries: RawQueryCall[] = [];
  rawQueryHandler: RawQueryHandler = defaultRawQueryHandler;
  /** Runs before every model operation; tests use it to simulate a concurrent writer or a failing query. */
  beforeOperation: ((modelName: string, operation: string, args: Row) => void) | null = null;
  private autoIncrement = 0;
  private clock = 0;

  /** Inserts rows as-is (defaults applied, no unique check) and returns them, for test fixtures. */
  seed(modelName: string, rows: Row[]): Row[] {
    const model = this.model(modelName);

    return rows.map((row) => {
      const created = this.applyDefaults(model, { ...row });

      this.table(model.name).push(created);

      return created;
    });
  }

  /** The stored rows of a model (by model name, e.g. "Income"), optionally filtered by a Prisma `where`. */
  rows(modelName: string, where?: Row): Row[] {
    const model = this.model(modelName);

    return this.table(model.name).filter((row) => this.matches(model, row, where));
  }

  /** The Prisma client view of this store, for code that takes a `db` parameter. */
  client(): TenantPrismaClient {
    const handler: ProxyHandler<Row> = {
      get: (_target, property) => {
        if (typeof property !== 'string') return undefined;
        if (property === '$transaction') return (arg: unknown) => this.transaction(arg);
        if (property === '$queryRaw' || property === '$executeRaw') {
          return (strings: unknown, ...values: unknown[]) => this.raw(strings, values, property);
        }
        if (property === '$queryRawUnsafe' || property === '$executeRawUnsafe') {
          return (sql: string, ...values: unknown[]) => this.raw(sql, values, property);
        }
        if (property === 'then') return undefined;
        const model = modelByDelegate.get(property);

        return model ? this.delegate(model) : unsupported(`client property "${property}"`);
      },
    };

    return new Proxy({}, handler) as unknown as TenantPrismaClient;
  }

  private model(name: string): DmmfModel {
    const model = modelByName.get(name) ?? modelByDelegate.get(name);

    if (!model) throw new Error(`in-memory prisma: unknown model ${name}`);

    return model;
  }

  private table(name: string): Row[] {
    let table = this.tables.get(name);

    if (!table) {
      table = [];
      this.tables.set(name, table);
    }

    return table;
  }

  private now(): Date {
    // Strictly increasing timestamps keep createdAt ordering deterministic for rows created in one millisecond.
    this.clock = Math.max(this.clock + 1, Date.now());

    return new Date(this.clock);
  }

  private raw(strings: unknown, values: unknown[], method: string): Promise<unknown> {
    let sql: string;
    let params: unknown[] = values;

    if (Array.isArray(strings)) {
      sql = strings.join('?');
    } else if (typeof strings === 'string') {
      sql = strings;
    } else if (strings instanceof Prisma.Sql) {
      sql = strings.sql;
      params = strings.values;
    } else {
      return Promise.reject(new Error(`in-memory prisma: unsupported ${method} argument`));
    }
    this.rawQueries.push({ sql, values: params });

    return Promise.resolve().then(() => this.rawQueryHandler(sql, params, this));
  }

  private async transaction(arg: unknown): Promise<unknown> {
    if (Array.isArray(arg)) return Promise.all(arg);
    if (typeof arg !== 'function') return unsupported('$transaction argument');
    const snapshot = new Map([...this.tables.entries()].map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));

    try {
      return await (arg as (tx: TenantPrismaClient) => Promise<unknown>)(this.client());
    } catch (error: unknown) {
      this.tables.clear();
      for (const [name, rows] of snapshot) this.tables.set(name, rows);
      throw error;
    }
  }

  private delegate(model: DmmfModel): Record<string, (args?: Row) => Promise<unknown>> {
    const findFirst = (args: Row) => this.findMany(model, { ...args, take: 1 })[0] ?? null;
    const findOrThrow = (args: Row) => {
      const found = findFirst(args);

      if (found === null) throw new InMemoryPrismaError(`No ${model.name} found`, 'P2025');

      return found;
    };
    const operations: Record<string, (args: Row) => unknown> = {
      findMany: (args) => this.findMany(model, args),
      findFirst,
      findUnique: findFirst,
      findFirstOrThrow: findOrThrow,
      findUniqueOrThrow: findOrThrow,
      count: (args) => this.filter(model, args.where).length,
      aggregate: (args) => this.aggregate(this.filter(model, args.where), args),
      groupBy: (args) => this.groupBy(model, args),
      create: (args) => this.project(model, this.insert(model, args.data), args),
      createMany: (args) => this.createMany(model, args),
      update: (args) => this.updateOne(model, args),
      updateMany: (args) => {
        const targets = this.filter(model, args.where);

        for (const row of targets) this.applyUpdate(model, row, args.data);

        return { count: targets.length };
      },
      upsert: (args) => {
        const existing = this.filter(model, args.where)[0];

        if (existing) return this.project(model, this.applyUpdate(model, existing, args.update), args);

        return this.project(model, this.insert(model, args.create), args);
      },
      delete: (args) => {
        const existing = this.filter(model, args.where)[0];

        if (!existing) throw new InMemoryPrismaError(`No ${model.name} found to delete`, 'P2025');
        this.remove(model, [existing]);

        return this.project(model, existing, args);
      },
      deleteMany: (args) => {
        const targets = this.filter(model, args.where);

        this.remove(model, targets);

        return { count: targets.length };
      },
    };

    // Like the real client, every call returns a promise and reports failures as rejections, never synchronously.
    return Object.fromEntries(Object.entries(operations).map(([name, operation]) => [
      name,
      (args: Row = {}) => Promise.resolve().then(() => {
        this.beforeOperation?.(model.name, name, args);

        return operation(args);
      }),
    ]));
  }

  private remove(model: DmmfModel, targets: Row[]): void {
    const doomed = new Set(targets);

    this.tables.set(model.name, this.table(model.name).filter((row) => !doomed.has(row)));
  }

  private filter(model: DmmfModel, where: unknown): Row[] {
    return this.table(model.name).filter((row) => this.matches(model, row, where));
  }

  private matches(model: DmmfModel, row: Row, where: unknown): boolean {
    if (where === undefined || where === null) return true;
    if (!isRecord(where)) return unsupported(`where clause on ${model.name}`);

    return Object.entries(where).every(([key, condition]) => {
      if (condition === undefined) return true;
      if (key === 'AND') return (Array.isArray(condition) ? condition : [condition]).every((part) => this.matches(model, row, part));
      if (key === 'OR') return Array.isArray(condition) && condition.some((part) => this.matches(model, row, part));
      if (key === 'NOT') return !(Array.isArray(condition) ? condition : [condition]).some((part) => this.matches(model, row, part));
      const field = fieldOf(model, key);

      if (!field) {
        // A compound unique key such as `tenantId_customerNumber: { tenantId, customerNumber }`.
        if (isRecord(condition)) return this.matches(model, row, condition);

        return unsupported(`where key "${key}" on ${model.name}`);
      }
      if (field.kind === 'object') return this.matchesRelation(model, field, row, condition);

      return matchesScalarFilter(row[key], condition, field);
    });
  }

  private matchesRelation(model: DmmfModel, field: DmmfField, row: Row, condition: unknown): boolean {
    const target = this.model(field.type);
    const related = this.related(model, field, row);

    if (field.isList) {
      if (!isRecord(condition)) return unsupported(`list relation filter on ${field.name}`);
      const list = related as Row[];

      return Object.entries(condition).every(([operator, nested]) => {
        if (operator === 'some') return list.some((item) => this.matches(target, item, nested));
        if (operator === 'every') return list.every((item) => this.matches(target, item, nested));
        if (operator === 'none') return !list.some((item) => this.matches(target, item, nested));

        return unsupported(`list relation operator "${operator}"`);
      });
    }
    const single = related as Row | null;

    if (condition === null) return single === null;
    if (!isRecord(condition)) return unsupported(`relation filter on ${field.name}`);
    if ('is' in condition || 'isNot' in condition) {
      if (condition.is !== undefined) {
        if (condition.is === null ? single !== null : !single || !this.matches(target, single, condition.is)) return false;
      }
      if (condition.isNot !== undefined) {
        if (condition.isNot === null ? single === null : Boolean(single) && this.matches(target, single!, condition.isNot)) return false;
      }

      return true;
    }

    return single !== null && this.matches(target, single, condition);
  }

  /** The rows a relation field points at: a row or null for a to-one relation, an array for a list relation. */
  private related(model: DmmfModel, field: DmmfField, row: Row): Row | null | Row[] {
    const target = this.model(field.type);
    const from = field.relationFromFields ?? [];
    const to = field.relationToFields ?? [];

    if (from.length > 0) {
      if (from.some((name) => row[name] === null || row[name] === undefined)) return null;

      return this.table(target.name).find((candidate) => from.every((name, index) => valuesEqual(candidate[to[index]!], row[name]))) ?? null;
    }
    const back = target.fields.find((candidate) => (
      candidate.relationName === field.relationName && candidate !== field && (candidate.relationFromFields ?? []).length > 0
    ));

    if (!back) return unsupported(`relation ${model.name}.${field.name}`);
    const backFrom = back.relationFromFields ?? [];
    const backTo = back.relationToFields ?? [];
    const matches = this.table(target.name).filter((candidate) => backFrom.every((name, index) => valuesEqual(candidate[name], row[backTo[index]!])));

    return field.isList ? matches : (matches[0] ?? null);
  }

  private findMany(model: DmmfModel, args: Row): Row[] {
    let rows = this.filter(model, args.where);

    if (args.orderBy !== undefined) rows = this.sort(model, rows, args.orderBy);
    if (Array.isArray(args.distinct)) {
      const seen = new Set<string>();

      rows = rows.filter((row) => {
        const key = JSON.stringify((args.distinct as string[]).map((name) => comparable(row[name])));

        if (seen.has(key)) return false;
        seen.add(key);

        return true;
      });
    }
    if (args.cursor !== undefined) unsupported('cursor pagination');
    const skip = typeof args.skip === 'number' ? args.skip : 0;
    const take = typeof args.take === 'number' ? args.take : undefined;

    if (take !== undefined && take < 0) unsupported('negative take');
    rows = rows.slice(skip, take === undefined ? undefined : skip + take);

    return rows.map((row) => this.project(model, row, args));
  }

  private sort(model: DmmfModel, rows: Row[], orderBy: unknown): Row[] {
    const clauses = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((clause) => (isRecord(clause) ? Object.entries(clause).map(([key, value]) => ({ [key]: value })) : []));

    return [...rows].sort((left, right) => {
      for (const clause of clauses) {
        const result = this.compareByClause(model, left, right, clause);

        if (result !== 0) return result;
      }

      return 0;
    });
  }

  private compareByClause(model: DmmfModel, left: Row, right: Row, clause: Row): number {
    const [key, spec] = Object.entries(clause)[0]!;
    const field = fieldOf(model, key);

    if (!field) return unsupported(`orderBy key "${key}" on ${model.name}`);
    if (field.kind === 'object') {
      if (field.isList || !isRecord(spec)) return unsupported(`orderBy on relation ${field.name}`);
      const target = this.model(field.type);
      const leftRelated = this.related(model, field, left) as Row | null;
      const rightRelated = this.related(model, field, right) as Row | null;

      if (!leftRelated || !rightRelated) return leftRelated ? -1 : rightRelated ? 1 : 0;

      return this.compareByClause(target, leftRelated, rightRelated, spec);
    }
    const direction = isRecord(spec) ? spec.sort : spec;
    const nulls = isRecord(spec) ? spec.nulls : undefined;
    const sign = direction === 'desc' ? -1 : 1;
    const a = left[key];
    const b = right[key];
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;

    if (aNull || bNull) {
      if (aNull && bNull) return 0;
      // Postgres default: NULLS LAST for ascending, NULLS FIRST for descending.
      const nullsFirst = nulls === 'first' || (nulls === undefined && direction === 'desc');

      return aNull === nullsFirst ? -1 : 1;
    }

    return sign * compareValues(a, b);
  }

  private project(model: DmmfModel, row: Row, args: Row): Row {
    const select = isRecord(args.select) ? args.select : undefined;
    const include = isRecord(args.include) ? args.include : undefined;
    const result: Row = {};

    if (!select) {
      for (const field of model.fields) {
        if (field.kind !== 'object') result[field.name] = cloneValue(row[field.name] ?? null);
      }
    }
    for (const [key, spec] of Object.entries(select ?? include ?? {})) {
      if (spec === undefined || spec === false) continue;
      if (key === '_count') {
        result._count = this.countRelations(model, row, spec);
        continue;
      }
      const field = fieldOf(model, key);

      if (!field) return unsupported(`select key "${key}" on ${model.name}`);
      if (field.kind !== 'object') {
        result[key] = cloneValue(row[key] ?? null);
        continue;
      }
      const target = this.model(field.type);
      const nested = isRecord(spec) ? spec : {};
      const related = this.related(model, field, row);

      if (Array.isArray(related)) {
        result[key] = this.findManyWithin(target, related, nested);
      } else {
        result[key] = related ? this.project(target, related, nested) : null;
      }
    }

    return result;
  }

  private findManyWithin(target: DmmfModel, related: Row[], nested: Row): Row[] {
    let rows = related.filter((row) => this.matches(target, row, nested.where));

    if (nested.orderBy !== undefined) rows = this.sort(target, rows, nested.orderBy);
    const skip = typeof nested.skip === 'number' ? nested.skip : 0;
    const take = typeof nested.take === 'number' ? nested.take : undefined;

    rows = rows.slice(skip, take === undefined ? undefined : skip + take);

    return rows.map((row) => this.project(target, row, nested));
  }

  private countRelations(model: DmmfModel, row: Row, spec: unknown): Row {
    const select = isRecord(spec) && isRecord(spec.select) ? spec.select : unsupported('_count without select');
    const counts: Row = {};

    for (const [key, value] of Object.entries(select)) {
      const field = fieldOf(model, key);

      if (!field || !field.isList) return unsupported(`_count of ${key}`);
      const related = this.related(model, field, row) as Row[];
      const where = isRecord(value) ? value.where : undefined;

      counts[key] = related.filter((item) => this.matches(this.model(field.type), item, where)).length;
    }

    return counts;
  }

  private aggregate(rows: Row[], args: Row): Row {
    const result: Row = {};

    for (const [operation, spec] of Object.entries(args)) {
      if (operation === 'where' || operation === 'by' || operation === 'orderBy' || operation === 'having') continue;
      if (operation === '_count') {
        if (spec === true) {
          result._count = rows.length;
          continue;
        }
        result._count = Object.fromEntries(Object.keys(isRecord(spec) ? spec : {}).map((name) => [
          name,
          name === '_all' ? rows.length : rows.filter((row) => row[name] !== null && row[name] !== undefined).length,
        ]));
        continue;
      }
      if (!['_sum', '_min', '_max', '_avg'].includes(operation) || !isRecord(spec)) return unsupported(`aggregate ${operation}`);
      result[operation] = Object.fromEntries(Object.keys(spec).map((name) => {
        const values = rows.map((row) => row[name]).filter((value) => value !== null && value !== undefined);

        if (values.length === 0) return [name, null];
        if (operation === '_min' || operation === '_max') {
          const sorted = [...values].sort(compareValues);

          return [name, operation === '_min' ? sorted[0] : sorted[sorted.length - 1]];
        }
        const sum = values.reduce<number>((total, value) => total + Number(comparable(value)), 0);

        return [name, operation === '_avg' ? sum / values.length : sum];
      }));
    }

    return result;
  }

  private groupBy(model: DmmfModel, args: Row): Row[] {
    const by = Array.isArray(args.by) ? (args.by as string[]) : unsupported('groupBy without by');
    const groups = new Map<string, Row[]>();

    for (const row of this.filter(model, args.where)) {
      const key = JSON.stringify(by.map((name) => comparable(row[name] ?? null)));
      const bucket = groups.get(key) ?? [];

      bucket.push(row);
      groups.set(key, bucket);
    }
    if (args.having !== undefined) unsupported('groupBy having');
    let result = [...groups.values()].map((rows) => ({
      ...Object.fromEntries(by.map((name) => [name, cloneValue(rows[0]![name] ?? null)])),
      ...this.aggregate(rows, args),
    }));

    if (args.orderBy !== undefined) result = this.sort(model, result, args.orderBy);
    const skip = typeof args.skip === 'number' ? args.skip : 0;
    const take = typeof args.take === 'number' ? args.take : undefined;

    return result.slice(skip, take === undefined ? undefined : skip + take);
  }

  private createMany(model: DmmfModel, args: Row): { count: number } {
    const data = Array.isArray(args.data) ? args.data : [args.data];
    let count = 0;

    for (const item of data) {
      try {
        this.insert(model, item);
        count += 1;
      } catch (error: unknown) {
        if (!(args.skipDuplicates === true && error instanceof InMemoryPrismaError && error.code === 'P2002')) throw error;
      }
    }

    return { count };
  }

  private applyDefaults(model: DmmfModel, row: Row): Row {
    for (const field of model.fields) {
      if (field.kind === 'object') continue;
      if (row[field.name] !== undefined) {
        row[field.name] = this.storedValue(field, row[field.name]);
        continue;
      }
      const fallback = field.default;

      if (field.isUpdatedAt) {
        row[field.name] = this.now();
      } else if (isRecord(fallback) && typeof fallback.name === 'string') {
        if (/^(uuid|cuid)/.test(fallback.name)) row[field.name] = randomUUID();
        else if (fallback.name === 'now') row[field.name] = this.now();
        else if (fallback.name === 'autoincrement') row[field.name] = ++this.autoIncrement;
        else if (fallback.name === 'dbgenerated') row[field.name] = null;
        else unsupported(`default ${fallback.name}`);
      } else if (fallback !== undefined) {
        row[field.name] = this.storedValue(field, cloneValue(fallback));
      } else {
        row[field.name] = field.isList ? [] : null;
      }
    }

    return row;
  }

  private storedValue(field: DmmfField, value: unknown): unknown {
    if (value === Prisma.JsonNull || value === Prisma.DbNull) return null;
    if (field.type === 'Decimal' && value !== null && !Prisma.Decimal.isDecimal(value)) return new Prisma.Decimal(value as number);
    if (field.type === 'DateTime' && typeof value === 'string') return new Date(value);

    return cloneValue(value);
  }

  private insert(model: DmmfModel, data: unknown): Row {
    if (!isRecord(data)) return unsupported(`create data on ${model.name}`);
    const row: Row = {};
    const nestedCreates: Array<{ field: DmmfField; payload: unknown }> = [];

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const field = fieldOf(model, key);

      if (!field) return unsupported(`create key "${key}" on ${model.name}`);
      if (field.kind !== 'object') {
        row[key] = value;
        continue;
      }
      if (!isRecord(value)) return unsupported(`relation write on ${key}`);
      if (isRecord(value.connect) && (field.relationFromFields ?? []).length > 0) {
        const target = this.model(field.type);
        const connected = this.filter(target, value.connect)[0];

        if (!connected) throw new InMemoryPrismaError(`No ${target.name} to connect`, 'P2025');
        (field.relationFromFields ?? []).forEach((name, index) => {
          row[name] = connected[(field.relationToFields ?? [])[index]!];
        });
      } else if (value.create !== undefined && field.isList) {
        nestedCreates.push({ field, payload: value.create });
      } else {
        unsupported(`relation write on ${key}`);
      }
    }
    const created = this.applyDefaults(model, row);

    this.assertUnique(model, created);
    this.table(model.name).push(created);
    for (const { field, payload } of nestedCreates) {
      const target = this.model(field.type);
      const back = target.fields.find((candidate) => candidate.relationName === field.relationName && (candidate.relationFromFields ?? []).length > 0)!;
      const children = Array.isArray(payload) ? payload : [payload];

      for (const child of children) {
        const link = Object.fromEntries((back.relationFromFields ?? []).map((name, index) => [name, created[(back.relationToFields ?? [])[index]!]]));

        this.insert(target, { ...(child as Row), ...link });
      }
    }

    return created;
  }

  private uniqueKeys(model: DmmfModel): string[][] {
    const keys: string[][] = [...model.uniqueFields.map((fields) => [...fields])];

    for (const field of model.fields) {
      if (field.isId || field.isUnique) keys.push([field.name]);
    }
    if (model.primaryKey) keys.push([...model.primaryKey.fields]);

    return keys;
  }

  private assertUnique(model: DmmfModel, row: Row, ignore?: Row): void {
    for (const key of this.uniqueKeys(model)) {
      if (key.some((name) => row[name] === null || row[name] === undefined)) continue;
      const clash = this.table(model.name).some((other) => other !== ignore && other !== row && key.every((name) => valuesEqual(other[name], row[name])));

      if (clash) throw new InMemoryPrismaError(`Unique constraint failed on ${model.name}(${key.join(', ')})`, 'P2002');
    }
  }

  private updateOne(model: DmmfModel, args: Row): Row {
    const existing = this.filter(model, args.where)[0];

    if (!existing) throw new InMemoryPrismaError(`No ${model.name} found to update`, 'P2025');

    return this.project(model, this.applyUpdate(model, existing, args.data), args);
  }

  private applyUpdate(model: DmmfModel, row: Row, data: unknown): Row {
    if (!isRecord(data)) return unsupported(`update data on ${model.name}`);
    const next: Row = { ...row };

    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      const field = fieldOf(model, key);

      if (!field) return unsupported(`update key "${key}" on ${model.name}`);
      if (field.kind === 'object') {
        if (isRecord(value) && value.disconnect === true && (field.relationFromFields ?? []).length > 0) {
          for (const name of field.relationFromFields ?? []) next[name] = null;
          continue;
        }
        if (isRecord(value) && isRecord(value.connect) && (field.relationFromFields ?? []).length > 0) {
          const connected = this.filter(this.model(field.type), value.connect)[0];

          if (!connected) throw new InMemoryPrismaError('No row to connect', 'P2025');
          (field.relationFromFields ?? []).forEach((name, index) => {
            next[name] = connected[(field.relationToFields ?? [])[index]!];
          });
          continue;
        }

        return unsupported(`relation update on ${key}`);
      }
      if (isRecord(value) && field.type !== 'Json') {
        const current = Number(comparable(next[key] ?? 0));

        if ('set' in value) next[key] = this.storedValue(field, value.set);
        else if ('increment' in value) next[key] = this.storedValue(field, current + Number(value.increment));
        else if ('decrement' in value) next[key] = this.storedValue(field, current - Number(value.decrement));
        else if ('multiply' in value) next[key] = this.storedValue(field, current * Number(value.multiply));
        else if ('push' in value && Array.isArray(next[key])) next[key] = [...(next[key] as unknown[]), ...[value.push].flat()];
        else unsupported(`update operation on ${key}`);
        continue;
      }
      next[key] = this.storedValue(field, value);
    }
    for (const field of model.fields) {
      if (field.isUpdatedAt && data[field.name] === undefined) next[field.name] = this.now();
    }
    this.assertUnique(model, next, row);
    const table = this.table(model.name);
    const index = table.indexOf(row);

    table[index] = next;

    return next;
  }
}

/**
 * Answers the sale-chain row lock (`SELECT id FROM incomes ... FOR UPDATE`) with the ids it would lock; every other
 * raw query returns no rows. Tests that need other raw queries set `rawQueryHandler`.
 */
export function defaultRawQueryHandler(sql: string, values: unknown[], db: InMemoryPrisma): unknown {
  if (/FROM incomes/i.test(sql) && /FOR UPDATE/i.test(sql)) {
    const [tenantId, saleId] = values;

    return db.rows('Income', { tenantId, OR: [{ id: saleId }, { relatedDebtIncomeId: saleId }] })
      .map((row) => ({ id: row.id }))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
  }
  if (/^\s*(UPDATE|INSERT|DELETE)/i.test(sql)) return 0;

  return [];
}
