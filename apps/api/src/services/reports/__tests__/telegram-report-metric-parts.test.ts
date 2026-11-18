import {
  amoLeadFacts,
  buildReportLeadWhere,
  classifyLeadOutcome,
  createLeadTally,
  localLeadFacts,
  readLeadOutcomeSettings,
  tallyLead,
  type LeadOutcomeSettings,
} from '../telegram-report/metrics-leads';
import { buildManagerRows, indexReportUsers, tallyManagerCalls } from '../telegram-report/metrics-managers';
import { buildSelectedCourseRows, tallyReportIncomes, type ReportIncomeRow } from '../telegram-report/metrics-sales';

const settings: LeadOutcomeSettings = {
  qualifiedStageIds: ['142'],
  qualifiedValues: ['Hot'],
  nonQualifiedValues: ['Qimmat'],
  reasonFieldKey: 'metadata:reason',
  sourceFieldKey: 'metadata:source',
};

describe('readLeadOutcomeSettings', () => {
  it('reads the dashboard lists as strings and the field keys when they are strings', () => {
    expect(readLeadOutcomeSettings({
      dashboard: { qualifiedStageIds: [142, '143'], qualifiedValues: 'x', nonQualifiedValues: [null], reasonFieldKey: 5, sourceFieldKey: 'metadata:source' },
    })).toEqual({
      qualifiedStageIds: ['142', '143'],
      qualifiedValues: [],
      nonQualifiedValues: ['null'],
      reasonFieldKey: null,
      sourceFieldKey: 'metadata:source',
    });
  });

  it('gives empty settings for missing or malformed input', () => {
    const empty = { qualifiedStageIds: [], qualifiedValues: [], nonQualifiedValues: [], reasonFieldKey: null, sourceFieldKey: null };

    expect(readLeadOutcomeSettings(null)).toEqual(empty);
    expect(readLeadOutcomeSettings([{ dashboard: {} }])).toEqual(empty);
    expect(readLeadOutcomeSettings({ dashboard: [1] })).toEqual(empty);
    expect(readLeadOutcomeSettings({ dashboard: 'x' })).toEqual(empty);
  });
});

describe('buildReportLeadWhere', () => {
  const start = new Date('2026-11-01T00:00:00Z');
  const end = new Date('2026-11-30T00:00:00Z');

  it('filters amoCRM-synced leads created in the period, by pipeline only when given', () => {
    const base = {
      tenantId: 't',
      amocrmId: { not: null },
      OR: [
        { externalCreatedAt: { gte: start, lte: end } },
        { externalCreatedAt: null, createdAt: { gte: start, lte: end } },
      ],
    };

    expect(buildReportLeadWhere('t', start, end, [])).toEqual(base);
    expect(buildReportLeadWhere('t', start, end, ['1', '2'])).toEqual({ ...base, pipelineId: { in: ['1', '2'] } });
  });
});

describe('classifyLeadOutcome', () => {
  it('qualifies by stage when stages are configured, else by reason value', () => {
    expect(classifyLeadOutcome(settings, ' 142 ', null)).toEqual({ isQualified: true, isNonQualified: false });
    expect(classifyLeadOutcome(settings, '143', 'hot')).toEqual({ isQualified: false, isNonQualified: false });
    expect(classifyLeadOutcome({ ...settings, qualifiedStageIds: [] }, '143', ' HOT ')).toEqual({ isQualified: true, isNonQualified: false });
    expect(classifyLeadOutcome({ ...settings, qualifiedStageIds: [] }, '143', null)).toEqual({ isQualified: false, isNonQualified: false });
  });

  it('marks lost leads with a non-qualified reason as non-qualified', () => {
    expect(classifyLeadOutcome(settings, '143', 'qimmat')).toEqual({ isQualified: false, isNonQualified: true });
    expect(classifyLeadOutcome(settings, '142', 'qimmat')).toEqual({ isQualified: true, isNonQualified: false });
    expect(classifyLeadOutcome(settings, '143', '  ')).toEqual({ isQualified: false, isNonQualified: false });
    expect(classifyLeadOutcome({ ...settings, nonQualifiedValues: [] }, '143', 'qimmat')).toEqual({ isQualified: false, isNonQualified: false });
  });
});

describe('lead tally', () => {
  it('counts reasons, sources and leads per manager, and reports qualified leads', () => {
    const tally = createLeadTally();
    const qualified = [
      tallyLead(tally, settings, { statusId: '142', reasonValue: null, sourceValue: 'Instagram', responsibleUserId: '7' }),
      tallyLead(tally, settings, { statusId: '143', reasonValue: 'Qimmat', sourceValue: 'Instagram', responsibleUserId: '7' }),
      tallyLead(tally, settings, { statusId: '143', reasonValue: 'qimmat', sourceValue: null, responsibleUserId: '' }),
    ];

    expect(qualified).toEqual([true, false, false]);
    expect(Array.from(tally.reasons)).toEqual([['Qimmat', 1], ['qimmat', 1]]);
    expect(Array.from(tally.sources)).toEqual([['Instagram', 2]]);
    expect(Array.from(tally.managerLeadsByAmoId)).toEqual([['7', { leads: 2, qualified: 1, nonQualified: 1 }]]);
  });

  it('reads the facts of live and local leads', () => {
    expect(amoLeadFacts({ status_id: 142, responsible_user_id: ' 7 ', reason: ' Qimmat ', source: 'Ads' }, settings)).toEqual({
      statusId: '142', reasonValue: 'Qimmat', sourceValue: 'Ads', responsibleUserId: '7',
    });
    expect(amoLeadFacts({}, { ...settings, reasonFieldKey: null })).toEqual({
      statusId: '', reasonValue: null, sourceValue: null, responsibleUserId: '',
    });
    expect(localLeadFacts({ status: ' 143', responsibleUserId: null, metadata: { reason: 'Uzoq' } }, settings)).toEqual({
      statusId: ' 143', reasonValue: 'Uzoq', sourceValue: null, responsibleUserId: '',
    });
  });
});

describe('tallyReportIncomes', () => {
  const row = (overrides: Partial<ReportIncomeRow>): ReportIncomeRow => ({
    type: 'new_sale', managerUserId: 'u1', paymentAmount: 0, coursePriceAmount: null, debtAmount: null, course: null, ...overrides,
  });

  it('sums income, new sales and agreements by category and per manager', () => {
    const { totals, managerSalesByUserId } = tallyReportIncomes([
      row({ managerUserId: 'u2', type: 'repayment', paymentAmount: 50 }),
      row({ paymentAmount: 100, coursePriceAmount: 1000, course: { category: 'online', name: 'A' } }),
      row({ paymentAmount: 200, debtAmount: 300, course: { category: 'offline', name: 'B' } }),
      row({ paymentAmount: 10, course: { category: 'intensive', name: 'C' } }),
      row({ managerUserId: 'u2', paymentAmount: 5, coursePriceAmount: 70, course: { category: 'additional_service', name: 'D' } }),
    ]);

    expect(totals).toEqual({
      incomeTotal: 365,
      newSalesCount: 4,
      agreementTotal: 1380,
      newSalesIncomeTotal: 315,
      debtRepaymentIncomeTotal: 50,
      onlineSalesCount: 1,
      onlineAgreementTotal: 1000,
      offlineSalesCount: 1,
      offlineAgreementTotal: 300,
      intensiveSalesCount: 1,
      intensiveAgreementTotal: 10,
    });
    expect(Array.from(managerSalesByUserId)).toEqual([
      ['u2', { sales: 1, agreementAmount: 70, incomeAmount: 55 }],
      ['u1', { sales: 3, agreementAmount: 1310, incomeAmount: 310 }],
    ]);
  });
});

describe('buildSelectedCourseRows', () => {
  it('keeps the selection order, drops unknown courses and sorts tariffs by count then name', () => {
    const rows = buildSelectedCourseRows(
      ['c2', 'missing', 'c1'],
      [{ id: 'c1', name: 'Python' }, { id: 'c2', name: 'Design' }],
      [
        { courseId: 'c1', tariff: { name: 'Pro' } },
        { courseId: 'c1', tariff: { name: 'Basic' } },
        { courseId: 'c1', tariff: null },
        { courseId: 'c1', tariff: { name: ' Pro ' } },
        { courseId: 'c9', tariff: { name: 'Pro' } },
        { courseId: null, tariff: { name: 'Pro' } },
      ],
    );

    expect(rows).toEqual([
      { courseId: 'c2', courseName: 'Design', salesCount: 0, tariffBreakdown: [] },
      {
        courseId: 'c1',
        courseName: 'Python',
        salesCount: 4,
        tariffBreakdown: [{ label: 'Pro', value: 2 }, { label: 'Basic', value: 1 }, { label: "Tarif yo'q", value: 1 }],
      },
    ]);
  });
});

describe('manager rows', () => {
  const users = indexReportUsers([
    { id: 'u1', name: ' Ali ', username: 'ali', roles: ['OnlineAgent'], amocrmResponsibleUserId: '500' },
    { id: 'u2', name: null, username: 'vali', roles: ['OfflineAgent'], amocrmResponsibleUserId: null },
    { id: 'u3', name: null, username: null, roles: ['Admin'], amocrmResponsibleUserId: '501' },
    { id: 'u4', name: 'Gani', username: null, roles: ['TeamLeader'], amocrmResponsibleUserId: null },
  ]);

  it('names users and maps amoCRM ids and groups', () => {
    expect(Array.from(users.usersById.values())).toEqual([
      { id: 'u1', name: 'Ali', group: 'online' },
      { id: 'u2', name: 'vali', group: 'offline' },
      { id: 'u3', name: 'u3', group: null },
      { id: 'u4', name: 'Gani', group: 'offline' },
    ]);
    expect(Array.from(users.usersByAmoId.keys())).toEqual(['500', '501']);
  });

  it('tallies talk time, calls and long calls per manager', () => {
    const calls = tallyManagerCalls([
      { managerUserId: 'u1', duration: 240 },
      { managerUserId: 'u1', duration: -5 },
      { managerUserId: null, duration: 999 },
      { managerUserId: 'u2', duration: null },
    ]);

    expect(Array.from(calls.durationByUserId)).toEqual([['u1', 240], ['u2', 0]]);
    expect(Array.from(calls.countsByUserId)).toEqual([['u1', { calls: 2, longCalls: 1 }], ['u2', { calls: 1, longCalls: 0 }]]);
  });

  it('joins leads, sales and calls into sorted rows of grouped, active managers', () => {
    const rows = buildManagerRows({
      users,
      managerLeadsByAmoId: new Map([['500', { leads: 4, qualified: 2, nonQualified: 1 }], ['501', { leads: 9, qualified: 0, nonQualified: 0 }], ['999', { leads: 1, qualified: 0, nonQualified: 0 }]]),
      managerSalesByUserId: new Map([['u1', { sales: 1, agreementAmount: 900, incomeAmount: 300 }], ['u2', { sales: 1, agreementAmount: 100, incomeAmount: 100 }], ['ghost', { sales: 5, agreementAmount: 1, incomeAmount: 1 }]]),
      calls: tallyManagerCalls([{ managerUserId: 'u4', duration: 60 }, { managerUserId: 'u1', duration: 300 }]),
      corporateDurationByUserId: new Map([['u1', 15]]),
    });

    expect(rows).toEqual([
      { group: 'online', name: 'Ali', leads: 4, qualified: 2, nonQualified: 1, sales: 1, conversion: 25, agreementAmount: 900, incomeAmount: 300, callDurationSeconds: 315, callCount: 1, longCallCount: 1 },
      { group: 'offline', name: 'vali', leads: 0, qualified: 0, nonQualified: 0, sales: 1, conversion: 0, agreementAmount: 100, incomeAmount: 100, callDurationSeconds: 0, callCount: 0, longCallCount: 0 },
      { group: 'offline', name: 'Gani', leads: 0, qualified: 0, nonQualified: 0, sales: 0, conversion: 0, agreementAmount: 0, incomeAmount: 0, callDurationSeconds: 60, callCount: 1, longCallCount: 0 },
    ]);
  });
});
