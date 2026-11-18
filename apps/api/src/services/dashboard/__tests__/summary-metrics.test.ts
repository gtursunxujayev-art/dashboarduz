import { createAmoCRMActivityDiagnostics } from '../../integrations/amocrm-activity';
import { classifyLeadQualification } from '../lead-qualification';
import {
  buildSellerPerformance,
  buildSellerPerformanceRow,
  buildSummaryPieChart,
  compareSellerPerformanceRows,
  countLeadsByResponsibleUser,
  countSummaryLeads,
  listUnmappedSellerNames,
  resolveSummaryActivityStatus,
  type SellerPerformanceInputs,
  summarizeIncomeByManager,
  summarizeNewSalesByCategory,
  summarizeTalkTime,
} from '../summary-metrics';
import { createSummarySourceStatus } from '../summary-sources';

const rules = {
  reasonFieldKey: 'metadata:quality',
  qualifiedValues: ['Sifatli'],
  nonQualifiedValues: ['Sifatsiz'],
  qualifiedStageIds: ['100'],
};

describe('classifyLeadQualification', () => {
  it('qualifies by stage when stages are configured, and by reason value otherwise', () => {
    expect(classifyLeadQualification({ status_id: 100, quality: 'Sifatsiz' }, rules)).toEqual({ reasonValue: 'Sifatsiz', qualified: true, nonQualified: true });
    expect(classifyLeadQualification({ status_id: 200, quality: 'Sifatli' }, rules)).toEqual({ reasonValue: 'Sifatli', qualified: false, nonQualified: false });
    expect(classifyLeadQualification({ quality: ' sifatli ' }, { ...rules, qualifiedStageIds: [] }).qualified).toBe(true);
    expect(classifyLeadQualification({ quality: 'Sifatsiz' }, { ...rules, nonQualifiedValues: [] }).nonQualified).toBe(false);
  });
});

describe('countSummaryLeads', () => {
  it('counts qualified and non-qualified leads, reasons and sources', () => {
    const result = countSummaryLeads([
      { status_id: 100, quality: 'Sifatsiz', source: 'Instagram' },
      { status_id: 200, quality: 'Sifatsiz' },
      { status_id: 100, source: 'Instagram' },
    ], { ...rules, sourceFieldKey: 'metadata:source' });

    expect(result.qualifiedLeads).toBe(2);
    expect(result.nonQualifiedLeads).toBe(2);
    expect([...result.reasonCounts]).toEqual([['Sifatsiz', 2]]);
    expect([...result.sourceCounts]).toEqual([['Instagram', 2], ['Unknown source', 1]]);
  });

  it('counts no sources when no source field is configured', () => {
    expect(countSummaryLeads([{ status_id: 100 }], { ...rules, sourceFieldKey: null }).sourceCounts.size).toBe(0);
  });
});

describe('countLeadsByResponsibleUser', () => {
  it('counts new and qualified leads per responsible user and skips leads without one', () => {
    const counts = countLeadsByResponsibleUser([
      { responsible_user_id: 501, status_id: 100 },
      { responsible_user_id: '501', status_id: 200 },
      { responsible_user_id: '', status_id: 100 },
      { status_id: 100 },
    ], rules);

    expect([...counts]).toEqual([['501', { newLeads: 2, qualifiedLeads: 1 }]]);
  });
});

describe('sales and income summaries', () => {
  const online = { name: 'X', category: 'online' };

  it('splits new sales by course category, falling back to the course name', () => {
    expect(summarizeNewSalesByCategory([
      { paymentAmount: 1, coursePriceAmount: 10, debtAmount: 0, course: online },
      { paymentAmount: 1, coursePriceAmount: 5, debtAmount: 0, course: { name: 'offline', category: '' } },
      { paymentAmount: 1, coursePriceAmount: 7, debtAmount: 0, course: null },
    ])).toEqual({
      newSalesAgreementAmount: 22,
      onlineSalesCount: 1,
      onlineSalesAgreementAmount: 10,
      offlineSalesCount: 1,
      offlineSalesAgreementAmount: 5,
      intensiveSalesCount: 0,
      intensiveSalesAgreementAmount: 0,
    });
  });

  it('adds income per manager and counts only new sales as sales', () => {
    const result = summarizeIncomeByManager([
      { managerUserId: 'a', type: 'new_sale', paymentAmount: 4, coursePriceAmount: 10, debtAmount: 6, course: online },
      { managerUserId: 'a', type: 'repayment', paymentAmount: 6, coursePriceAmount: null, debtAmount: null, course: { name: 'Intensiv', category: 'intensive' } },
      { managerUserId: 'b', type: 'repayment', paymentAmount: null, coursePriceAmount: null, debtAmount: null, course: null },
    ]);

    expect(result.totalIncomeAmount).toBe(10);
    expect([result.onlineSalesIncomeAmount, result.offlineSalesIncomeAmount, result.intensiveSalesIncomeAmount]).toEqual([4, 0, 6]);
    expect([...result.salesByManager]).toEqual([
      ['a', { sales: 1, agreementsAmount: 10, incomeAmount: 10 }],
      ['b', { sales: 0, agreementsAmount: 0, incomeAmount: 0 }],
    ]);
  });
});

describe('summarizeTalkTime', () => {
  it('adds manual call time only for linked agents, agents with manual time or agents with calls', () => {
    const agents = [
      { id: 'linked', name: null, username: null, amocrmResponsibleUserId: '1' },
      { id: 'manual', name: null, username: null, amocrmResponsibleUserId: null },
      { id: 'silent', name: null, username: null, amocrmResponsibleUserId: ' ' },
    ];
    const result = summarizeTalkTime({
      calls: [{ managerUserId: 'linked', duration: -5 }, { managerUserId: null, duration: 10 }],
      agents,
      corporateDurationByUserId: new Map([['manual', 30]]),
    });

    expect([...result.talkSecondsByAgent]).toEqual([['linked', 0], ['manual', 30]]);
    expect([...result.callCountByAgent]).toEqual([['linked', 1]]);
    expect(listUnmappedSellerNames(agents)).toEqual(['manual', 'silent']);
  });
});

describe('resolveSummaryActivityStatus', () => {
  const base = { activityPending: false, amoConnected: true, activityManagerCount: 2, unmappedSellerCount: 0 };

  it('reports loading, not connected and missing mapping', () => {
    const loading = createSummarySourceStatus().activity;
    const disconnected = createSummarySourceStatus().activity;
    const unmapped = createSummarySourceStatus().activity;

    resolveSummaryActivityStatus(loading, { ...base, activityPending: true, diagnostics: createAmoCRMActivityDiagnostics() });
    resolveSummaryActivityStatus(disconnected, { ...base, amoConnected: false, diagnostics: createAmoCRMActivityDiagnostics() });
    resolveSummaryActivityStatus(unmapped, { ...base, activityManagerCount: 0, unmappedSellerCount: 3, diagnostics: createAmoCRMActivityDiagnostics() });

    expect(loading).toEqual({ ok: false, retried: false, reason: 'activity_loading', state: 'partial' });
    expect(disconnected).toEqual({ ok: false, retried: false, reason: 'amo_unavailable', state: 'unavailable' });
    expect(unmapped).toEqual({ ok: false, retried: false, reason: 'no_activity_mapping', state: 'mapping_missing' });
  });

  it('is unavailable when every activity source failed, and partial with unmapped sellers', () => {
    const diagnostics = {
      completedTasks: { ok: false, reason: 'timeout' },
      pendingTasks: { ok: false, reason: null },
      events: { ok: false, reason: 'network_error' },
    };
    const allFailed = createSummarySourceStatus().activity;
    const withUnmapped = createSummarySourceStatus().activity;

    resolveSummaryActivityStatus(allFailed, { ...base, diagnostics });
    resolveSummaryActivityStatus(withUnmapped, { ...base, unmappedSellerCount: 1, diagnostics: createAmoCRMActivityDiagnostics() });

    expect(allFailed).toEqual({ ok: false, retried: false, reason: 'timeout,network_error', state: 'unavailable' });
    expect(withUnmapped).toEqual({ ok: false, retried: false, reason: 'mapping_missing', state: 'partial' });
  });

  it('keeps a failed lookup reason and does not read diagnostics then', () => {
    const entry = { ok: false, retried: true, reason: 'timeout', state: 'timeout' as const };

    resolveSummaryActivityStatus(entry, { ...base, diagnostics: { ...createAmoCRMActivityDiagnostics(), events: { ok: false, reason: 'x' } } });

    expect(entry).toEqual({ ok: false, retried: true, reason: 'timeout', state: 'timeout' });
  });
});

describe('seller performance rows', () => {
  const inputs: SellerPerformanceInputs = {
    leadsByResponsibleUser: new Map([['501', { newLeads: 3, qualifiedLeads: 1 }]]),
    salesByManager: new Map([['a', { sales: 1, agreementsAmount: 100, incomeAmount: 50 }]]),
    activityByManager: new Map([['501', { followUpCount: 2, noteCount: 3, stageChangeCount: 4, overdueFollowUpCount: 5, todayFollowUpCount: 6 }]]),
    talkSecondsByAgent: new Map([['a', 90], ['b', 90]]),
    callCountByAgent: new Map([['a', 2]]),
    leadsDataAvailable: true,
    activityRequestUnavailable: false,
    diagnostics: { ...createAmoCRMActivityDiagnostics(), pendingTasks: { ok: false, reason: 'timeout' } },
    hideMoney: false,
  };
  const agentA = { id: 'a', name: 'Aziz', username: null, amocrmResponsibleUserId: '501' };
  const agentB = { id: 'b', name: null, username: 'bobur', amocrmResponsibleUserId: null };

  it('fills a linked agent row and leaves unavailable activity cells unknown', () => {
    expect(buildSellerPerformanceRow(agentA, inputs)).toEqual({
      userId: 'a',
      name: 'Aziz',
      newLeads: 3,
      qualifiedLeads: 1,
      sales: 1,
      conversionPercent: 33.33,
      agreementsAmount: 100,
      incomeAmount: 50,
      talkedSeconds: 90,
      callsCount: 2,
      followUpCount: 2,
      noteCount: 3,
      stageChangeCount: 4,
      overdueFollowUpCount: null,
      todayFollowUpCount: null,
      crmAvailability: { mapped: true, completedTasks: true, pendingTasks: false, events: true },
    });
  });

  it('shows unknown lead cells for unlinked agents and hides money when asked', () => {
    const row = buildSellerPerformanceRow(agentB, { ...inputs, hideMoney: true });

    expect([row.name, row.newLeads, row.conversionPercent, row.agreementsAmount, row.followUpCount]).toEqual(['bobur', null, null, 0, null]);
  });

  it('sorts by talk time, unknown last, then by name', () => {
    const rows = buildSellerPerformance([
      { ...agentB, id: 'c', username: 'zarina' },
      agentB,
      agentA,
    ], inputs);

    expect(rows.map((row) => row.name)).toEqual(['Aziz', 'bobur', 'zarina']);
    expect(compareSellerPerformanceRows(rows[0]!, rows[2]!)).toBeLessThan(0);
  });
});

describe('buildSummaryPieChart', () => {
  it('labels the field from the catalog, humanizes unknown keys, and has no label without a field', () => {
    const labels = new Map([['metadata:source', 'Manba']]);

    expect(buildSummaryPieChart('metadata:source', labels, new Map()).fieldLabel).toBe('Manba');
    expect(buildSummaryPieChart('metadata:quality', labels, new Map()).fieldLabel).toBe('Metadata Quality');
    expect(buildSummaryPieChart(null, labels, new Map([['a', 1]]))).toEqual({
      fieldKey: null,
      fieldLabel: null,
      data: [{ name: 'a', value: 1, color: expect.any(String) as unknown }],
    });
  });
});
