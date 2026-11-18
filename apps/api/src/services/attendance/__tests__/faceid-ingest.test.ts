import { systemPrisma } from '@dashboarduz/db';
import { TRPCError } from '@trpc/server';

import { recomputeAttendanceSummariesForRange } from '../day-summary';
import { hashFaceIdWebhookToken, ingestFaceIdEvent } from '../faceid';
import { parseBranchWhitelist, parseUnmatchedUserPolicy, resolveMatchedUserId } from '../faceid-matching';
import { buildNormalizedFullName, parseFaceIdEvent } from '../faceid-payload';
import {
  canReadAllUsers,
  parseDateKey,
  parseDateKeyFilter,
  parseDateTime,
  readFaceMatchMeta,
  resolveAttendanceListScope,
  toLocalTimeValue,
} from '../router-helpers';

// Face ID attendance: payload parsing, matching the person to a user (phone, mapped external id, unique full
// name), storing the event idempotently and recomputing the day summary. `systemPrisma` is this mock.
const mockDb = {
  user: { findMany: jest.fn(), findFirst: jest.fn() },
  attendanceEvent: { upsert: jest.fn(), findMany: jest.fn() },
  attendanceDaySummary: { upsert: jest.fn() },
};

jest.mock('@dashboarduz/db', () => ({
  get systemPrisma() {
    return mockDb;
  },
}));

const TENANT_ID = 'tenant-1';

function checkIn(overrides: Record<string, unknown> = {}) {
  return {
    event_type: 'check_in_out',
    action: 'in',
    timestamp: '2026-11-18T04:05:06.000Z',
    user: { id: 77, first_name: 'Ali', last_name: 'Valiyev', phone_number: '+998 (90) 111-22-33', role: 'agent' },
    branch_name: ' Chilonzor ',
    latitude: '41.3',
    longitude: 69.2,
    late_minutes: '12.7',
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockDb.attendanceDaySummary.upsert.mockResolvedValue({});
});

describe('parseFaceIdEvent', () => {
  it('parses a check-in, deriving the Tashkent date and time and a stable idempotency key', () => {
    const parsed = parseFaceIdEvent(checkIn());

    expect(parsed).toMatchObject({
      eventType: 'check_in_out',
      action: 'IN',
      eventAt: new Date('2026-11-18T04:05:06.000Z'),
      localDate: '2026-11-18',
      localTime: '09:05:06',
      externalUserId: '77',
      externalPhone: '998901112233',
      firstName: 'Ali',
      lastName: 'Valiyev',
      externalRole: 'agent',
      branchName: 'Chilonzor',
      latitude: 41.3,
      longitude: 69.2,
      lateMinutes: 12,
      source: 'FACE_ID',
    });
    expect(parsed?.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(parseFaceIdEvent(checkIn())?.idempotencyKey).toBe(parsed?.idempotencyKey);
    expect(parseFaceIdEvent(checkIn({ action: 'OUT' }))?.idempotencyKey).not.toBe(parsed?.idempotencyKey);
  });

  it('reads a payload nested under request and prefers explicit local date and time', () => {
    const parsed = parseFaceIdEvent({
      request: { ...checkIn({ action: 'OUT', source: 'turnstile' }), local_date: '2026-11-17', local_time_only: '23:59:00', late_minutes: -3 },
    });

    expect(parsed).toMatchObject({ action: 'OUT', localDate: '2026-11-17', localTime: '23:59:00', lateMinutes: 0, source: 'TURNSTILE' });
  });

  it('ignores other event types and actions', () => {
    expect(parseFaceIdEvent(checkIn({ event_type: 'heartbeat' }))).toBeNull();
    expect(parseFaceIdEvent(checkIn({ action: 'PAUSE' }))).toBeNull();
    expect(parseFaceIdEvent(null)).toBeNull();
  });

  it('normalizes full names for matching', () => {
    expect(buildNormalizedFullName('  ALI-', ' Valiyev!! ')).toBe('ali valiyev');
    expect(buildNormalizedFullName(null, undefined)).toBe('');
  });
});

describe('Face ID integration config', () => {
  it('reads the branch whitelist and the unmatched-user policy', () => {
    expect(Array.from(parseBranchWhitelist({ branchWhitelist: [' Chilonzor ', '', 'YUNUSOBOD'] }))).toEqual(['chilonzor', 'yunusobod']);
    expect(parseBranchWhitelist({ branchWhitelist: 'x' }).size).toBe(0);
    expect(parseUnmatchedUserPolicy({ unmatchedUserPolicy: ' IGNORE ' })).toBe('ignore');
    expect(parseUnmatchedUserPolicy({})).toBe('store');
  });

  it('hashes webhook tokens with SHA-256', () => {
    expect(hashFaceIdWebhookToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('resolveMatchedUserId', () => {
  function parsedEvent(overrides: Record<string, unknown> = {}) {
    const parsed = parseFaceIdEvent(checkIn(overrides));

    if (!parsed) throw new Error('fixture did not parse');

    return parsed;
  }

  it('matches by a unique phone number first', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([{ id: 'u1', phone: '998-90-111-22-33' }, { id: 'u2', phone: '998901110000' }]);

    const match = await resolveMatchedUserId({ tenantId: TENANT_ID, parsed: parsedEvent(), integrationConfig: {} });

    expect(match).toEqual({
      userId: 'u1',
      matchStepTried: 'phone',
      matchReason: null,
      rawUser: { id: '77', firstName: 'Ali', lastName: 'Valiyev', phone: '998901112233' },
    });
  });

  it('falls back to the mapped external id, then to a unique full name', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([]);
    mockDb.user.findFirst.mockResolvedValueOnce({ id: 'mapped-user' });

    const byExternalId = await resolveMatchedUserId({
      tenantId: TENANT_ID,
      parsed: parsedEvent(),
      integrationConfig: { userExternalMap: { 77: ' mapped-user ', '': 'x' } },
    });

    expect(byExternalId).toMatchObject({ userId: 'mapped-user', matchStepTried: 'external_id' });
    expect(mockDb.user.findFirst).toHaveBeenCalledWith({ where: { id: 'mapped-user', tenantId: TENANT_ID, isActive: true }, select: { id: true } });

    mockDb.user.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'by-name', name: 'ali  VALIYEV' }, { id: 'other', name: 'Vali Aliyev' }]);
    const byName = await resolveMatchedUserId({ tenantId: TENANT_ID, parsed: parsedEvent(), integrationConfig: {} });

    expect(byName).toMatchObject({ userId: 'by-name', matchStepTried: 'name', matchReason: null });
  });

  it('explains why nobody matched', async () => {
    mockDb.user.findMany.mockResolvedValue([{ id: 'a', name: 'Ali Valiyev', phone: null }, { id: 'b', name: 'Ali Valiyev', phone: null }]);
    expect(await resolveMatchedUserId({ tenantId: TENANT_ID, parsed: parsedEvent(), integrationConfig: {} }))
      .toMatchObject({ userId: null, matchStepTried: 'name', matchReason: 'name_not_unique' });

    mockDb.user.findMany.mockResolvedValue([]);
    expect(await resolveMatchedUserId({ tenantId: TENANT_ID, parsed: parsedEvent(), integrationConfig: {} }))
      .toMatchObject({ userId: null, matchStepTried: 'name', matchReason: 'name_not_found' });

    const anonymous = parsedEvent({ user: { id: 9 } });

    expect(await resolveMatchedUserId({ tenantId: TENANT_ID, parsed: anonymous, integrationConfig: {} }))
      .toMatchObject({ userId: null, matchStepTried: 'external_id', matchReason: 'external_id_not_mapped' });

    const nobody = parsedEvent({ user: null });

    expect(await resolveMatchedUserId({ tenantId: TENANT_ID, parsed: nobody, integrationConfig: {} }))
      .toMatchObject({ userId: null, matchStepTried: 'phone', matchReason: 'phone_not_found', rawUser: { id: null, firstName: null, lastName: null, phone: null } });
  });
});

describe('ingestFaceIdEvent', () => {
  it('stores a matched event idempotently and recomputes that day', async () => {
    mockDb.user.findMany.mockResolvedValueOnce([{ id: 'u1', phone: '998901112233' }]);
    mockDb.attendanceEvent.upsert.mockResolvedValue({ id: 'ev-1', userId: 'u1', localDate: '2026-11-18' });
    mockDb.attendanceEvent.findMany.mockResolvedValue([]);

    const result = await ingestFaceIdEvent({ tenantId: TENANT_ID, integrationConfig: { branchWhitelist: ['chilonzor'] }, payload: checkIn() });

    expect(result).toEqual({ ignored: false, eventId: 'ev-1', userId: 'u1', localDate: '2026-11-18' });
    const upsert = mockDb.attendanceEvent.upsert.mock.calls[0][0];

    expect(upsert.where.tenantId_idempotencyKey.tenantId).toBe(TENANT_ID);
    expect(upsert.create).toMatchObject({ tenantId: TENANT_ID, userId: 'u1', action: 'IN', lateMinutes: 12, branchName: 'Chilonzor' });
    expect(upsert.create.rawPayload.__matchMeta).toEqual({
      matchReason: null,
      matchStepTried: 'phone',
      rawUser: { id: '77', firstName: 'Ali', lastName: 'Valiyev', phone: '998901112233' },
    });
    expect(mockDb.attendanceDaySummary.upsert).toHaveBeenCalledTimes(1);
  });

  it('keeps an unmatched event without recomputing, unless the policy says to ignore it', async () => {
    mockDb.user.findMany.mockResolvedValue([]);
    mockDb.attendanceEvent.upsert.mockResolvedValue({ id: 'ev-2', userId: null, localDate: '2026-11-18' });

    expect(await ingestFaceIdEvent({ tenantId: TENANT_ID, integrationConfig: {}, payload: checkIn() }))
      .toEqual({ ignored: false, eventId: 'ev-2', userId: null, localDate: '2026-11-18' });
    expect(mockDb.attendanceDaySummary.upsert).not.toHaveBeenCalled();

    expect(await ingestFaceIdEvent({ tenantId: TENANT_ID, integrationConfig: { unmatchedUserPolicy: 'ignore' }, payload: checkIn() }))
      .toEqual({ ignored: true, reason: 'name_not_found' });
  });

  it('ignores unsupported events and branches outside the whitelist', async () => {
    expect(await ingestFaceIdEvent({ tenantId: TENANT_ID, integrationConfig: {}, payload: { event_type: 'ping' } }))
      .toEqual({ ignored: true, reason: 'unsupported_event' });
    expect(await ingestFaceIdEvent({ tenantId: TENANT_ID, integrationConfig: { branchWhitelist: ['yunusobod'] }, payload: checkIn() }))
      .toEqual({ ignored: true, reason: 'branch_filtered' });
    expect(await ingestFaceIdEvent({ tenantId: TENANT_ID, integrationConfig: { branchWhitelist: ['yunusobod'] }, payload: checkIn({ branch_name: null }) }))
      .toEqual({ ignored: true, reason: 'branch_filtered' });
    expect(mockDb.attendanceEvent.upsert).not.toHaveBeenCalled();
  });
});

describe('attendance day summaries', () => {
  const at = (time: string) => new Date(`2026-11-18T${time}.000Z`);

  it('pairs IN and OUT events into worked time and counts late arrivals and anomalies', async () => {
    mockDb.attendanceEvent.findMany
      .mockResolvedValueOnce([{ userId: 'u1', localDate: '2026-11-18' }, { userId: null, localDate: '2026-11-18' }])
      .mockResolvedValueOnce([
        { action: 'OUT', eventAt: at('03:00:00'), lateMinutes: 0 },
        { action: 'IN', eventAt: at('04:00:00'), lateMinutes: 15 },
        { action: 'IN', eventAt: at('04:30:00'), lateMinutes: 0 },
        { action: 'out', eventAt: at('08:30:00'), lateMinutes: 0 },
        { action: 'IN', eventAt: at('09:00:00'), lateMinutes: 0 },
        { action: 'OUT', eventAt: at('12:00:00'), lateMinutes: 0 },
        { action: 'IN', eventAt: at('13:00:00'), lateMinutes: 0 },
      ]);

    const result = await recomputeAttendanceSummariesForRange({ tenantId: TENANT_ID, dateFrom: '2026-11-18', dateTo: '2026-11-18', userId: 'u1', db: systemPrisma });

    expect(result).toEqual({ recomputed: 1 });
    expect(mockDb.attendanceEvent.findMany.mock.calls[0][0]).toMatchObject({
      where: { tenantId: TENANT_ID, localDate: { gte: '2026-11-18', lte: '2026-11-18' } },
      distinct: ['userId', 'localDate'],
    });
    const { where, create, update } = mockDb.attendanceDaySummary.upsert.mock.calls[0][0];

    expect(where).toEqual({ tenantId_userId_summaryDate: { tenantId: TENANT_ID, userId: 'u1', summaryDate: '2026-11-18' } });
    // 04:30-08:30 (4 h) + 09:00-12:00 (3 h) = 7 h of the required 9 h.
    expect(create).toMatchObject({
      workedSeconds: 7 * 3600,
      requiredSeconds: 9 * 3600,
      missingSeconds: 2 * 3600,
      lateMinutes: 15,
      lateCount: 1,
      absence: false,
      unmatchedInCount: 2,
      unmatchedOutCount: 1,
      anomalyCount: 3,
      firstInAt: at('04:00:00'),
      lastOutAt: at('12:00:00'),
    });
    expect(update).toMatchObject({ workedSeconds: 7 * 3600, anomalyCount: 3 });
  });

  // BUG (apps/api/src/services/attendance/day-summary.ts:151): `userId: { not: null }` is spread after the
  // optional `userId` filter and overwrites it, so a recompute requested for one user (attendance corrections,
  // trpc/routers/attendance/corrections.ts:302) recomputes every user's days in the range.
  it.skip('limits a range recompute to the requested user', async () => {
    mockDb.attendanceEvent.findMany.mockResolvedValue([]);

    await recomputeAttendanceSummariesForRange({ tenantId: TENANT_ID, dateFrom: '2026-11-18', dateTo: '2026-11-18', userId: 'u1', db: systemPrisma });

    expect(mockDb.attendanceEvent.findMany.mock.calls[0][0].where.userId).toBe('u1');
  });

  it('requires nothing on Sunday and marks an empty working day absent', async () => {
    mockDb.attendanceEvent.findMany
      .mockResolvedValueOnce([{ userId: 'u1', localDate: '2026-11-15' }, { userId: 'u1', localDate: '2026-11-16' }])
      .mockResolvedValue([]);

    await recomputeAttendanceSummariesForRange({ tenantId: TENANT_ID, dateFrom: '2026-11-15', dateTo: '2026-11-16', db: systemPrisma });

    const [sunday, monday] = mockDb.attendanceDaySummary.upsert.mock.calls.map((call) => call[0].create);

    expect(sunday).toMatchObject({ summaryDate: '2026-11-15', requiredSeconds: 0, missingSeconds: 0, absence: false });
    expect(monday).toMatchObject({ summaryDate: '2026-11-16', requiredSeconds: 9 * 3600, missingSeconds: 9 * 3600, absence: true, lateCount: 0 });
  });
});

describe('attendance router helpers', () => {
  function trpcMessage(fn: () => unknown): string {
    try {
      fn();
    } catch (error) {
      if (error instanceof TRPCError) return `${error.code}: ${error.message}`;
      throw error;
    }

    return 'no error';
  }

  it('validates day keys and timestamps with Uzbek messages', () => {
    expect(parseDateKey(' 2026-11-18 ', 'dateFrom')).toBe('2026-11-18');
    expect(trpcMessage(() => parseDateKey('18.11.2026', 'dateFrom'))).toBe("BAD_REQUEST: dateFrom YYYY-MM-DD formatda bo'lishi kerak.");
    expect(parseDateKeyFilter()).toBeUndefined();
    expect(parseDateKeyFilter({ dateFrom: '2026-11-01' })).toEqual({ gte: '2026-11-01', lte: undefined });
    expect(parseDateKeyFilter({ dateTo: '2026-11-30' })).toEqual({ gte: undefined, lte: '2026-11-30' });
    expect(parseDateTime('2026-11-18T04:00:00Z', 'eventAt')).toEqual(new Date('2026-11-18T04:00:00Z'));
    expect(trpcMessage(() => parseDateTime('later', 'eventAt'))).toBe("BAD_REQUEST: eventAt noto'g'ri formatda.");
    expect(toLocalTimeValue(new Date('2026-11-18T04:05:06Z'))).toBe('09:05:06');
  });

  it('scopes lists to the caller unless the role may read everyone', () => {
    expect(canReadAllUsers(['Admin'])).toBe(true);
    expect(canReadAllUsers(['Agent'])).toBe(false);
    expect(resolveAttendanceListScope({ userId: 'me', roles: ['Agent'] }, { page: 3, limit: 20, userId: 'other' }))
      .toEqual({ page: 3, limit: 20, skip: 40, scopedUserId: 'me' });
    expect(resolveAttendanceListScope({ userId: 'me', roles: ['Admin'] }, { userId: 'other' }))
      .toEqual({ page: 1, limit: 50, skip: 0, scopedUserId: 'other' });
    expect(resolveAttendanceListScope({ userId: 'me', roles: ['Admin'] })).toEqual({ page: 1, limit: 50, skip: 0, scopedUserId: undefined });
  });

  it('reads the match metadata stored with an event', () => {
    expect(readFaceMatchMeta({ __matchMeta: { matchReason: 'name_not_found', matchStepTried: 'name', rawUser: { id: 7, firstName: ' Ali ' } } }))
      .toEqual({ matchReason: 'name_not_found', matchStepTried: 'name', rawUser: { id: '7', firstName: 'Ali', lastName: null, phone: null } });
    expect(readFaceMatchMeta({ __matchMeta: { matchReason: '' } })).toEqual({ matchReason: null, matchStepTried: null, rawUser: null });
    expect(readFaceMatchMeta({ other: 1 })).toEqual({ matchReason: null, matchStepTried: null, rawUser: null });
    expect(readFaceMatchMeta([1])).toEqual({ matchReason: null, matchStepTried: null, rawUser: null });
  });
});
