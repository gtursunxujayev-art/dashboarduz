import {
  classifyManagerGroup,
  compareManagerRows,
  createStyledReportPdf,
  getBreakdownLayout,
  groupManagerRows,
  type ManagerGroup,
  type ReportManagerRow,
  type ReportMetrics,
} from '../telegram-report-scheduler';

function createManagerRow(
  name: string,
  group: ManagerGroup,
  overrides: Partial<ReportManagerRow> = {},
): ReportManagerRow {
  return {
    group,
    name,
    leads: 1,
    qualified: 1,
    nonQualified: 0,
    sales: 0,
    conversion: 0,
    agreementAmount: 0,
    incomeAmount: 0,
    callDurationSeconds: 0,
    ...overrides,
  };
}

function createMetrics(overrides: Partial<ReportMetrics> = {}): ReportMetrics {
  return {
    newLeads: 185,
    qualifiedLeads: 34,
    nonQualifiedLeads: 14,
    qualifiedShare: 18.4,
    nonQualifiedShare: 7.57,
    newSalesCount: 4,
    conversionPercent: 2.16,
    agreementTotal: 12_100_000,
    incomeTotal: 7_500_000,
    newSalesIncomeTotal: 7_000_000,
    debtRepaymentIncomeTotal: 500_000,
    onlineSalesCount: 0,
    onlineAgreementTotal: 0,
    offlineSalesCount: 0,
    offlineAgreementTotal: 0,
    intensiveSalesCount: 4,
    intensiveAgreementTotal: 12_100_000,
    totalCalls: 848,
    talkDurationSeconds: 48_900,
    reasonBreakdown: [{ label: 'Dubl', value: 4 }],
    sourceBreakdown: [{ label: 'Target', value: 67 }],
    selectedCourseRows: [],
    managerRows: [],
    ...overrides,
  };
}

function createPdf(metrics: ReportMetrics): string {
  return createStyledReportPdf({
    tenantName: 'Najot Nur',
    title: 'Kunlik hisobot (Kecha)',
    periodStart: new Date('2026-07-23T19:00:00.000Z'),
    periodEnd: new Date('2026-07-24T18:59:59.999Z'),
    generatedAt: new Date('2026-07-25T03:00:00.000Z'),
    metrics,
  }).toString('latin1');
}

describe('Telegram report manager grouping', () => {
  it('classifies explicit agent roles and gives OnlineAgent precedence', () => {
    expect(classifyManagerGroup(['OnlineAgent'])).toBe('online');
    expect(classifyManagerGroup(['OfflineAgent'])).toBe('offline');
    expect(classifyManagerGroup(['OfflineAgent', 'OnlineAgent'])).toBe('online');
  });

  it('excludes generic and non-agent roles', () => {
    expect(classifyManagerGroup(['Agent'])).toBeNull();
    expect(classifyManagerGroup(['TeamLeader'])).toBeNull();
    expect(classifyManagerGroup(['Manager'])).toBeNull();
    expect(classifyManagerGroup([])).toBeNull();
  });

  it('hides empty groups and preserves the established row ordering', () => {
    const rows = [
      createManagerRow('Zulu', 'online', { sales: 1, leads: 10 }),
      createManagerRow('Alpha', 'online', { sales: 2, leads: 2 }),
      createManagerRow('Bravo', 'online', { sales: 1, leads: 12 }),
    ];

    expect([...rows].sort(compareManagerRows).map((row) => row.name)).toEqual(['Alpha', 'Bravo', 'Zulu']);
    expect(groupManagerRows(rows)).toEqual([
      {
        group: 'online',
        label: 'Online agentlar',
        rows: [rows[1], rows[2], rows[0]],
      },
    ]);
  });
});

describe('Telegram report compact layout', () => {
  it('uses content-driven breakdown heights', () => {
    const oneRow = getBreakdownLayout([{ label: 'Target', value: 67 }]);
    const threeRows = getBreakdownLayout([
      { label: 'One', value: 1 },
      { label: 'Two', value: 2 },
      { label: 'Three', value: 3 },
      { label: 'Four', value: 4 },
      { label: 'Five', value: 5 },
      { label: 'Six', value: 6 },
    ]);

    expect(oneRow.rowCount).toBe(1);
    expect(threeRows.rowCount).toBe(3);
    expect(threeRows.height - oneRow.height).toBe(28);
  });

  it('renders seven 54-point KPI cards and the paired summary labels', () => {
    const pdf = createPdf(createMetrics());
    const cardRectangles = pdf
      .split('\n')
      .filter((line) => / (160|78) 54 re$/.test(line));

    expect(cardRectangles).toHaveLength(7);
    expect(pdf).toContain('(Sifatsiz lidlar: 14) Tj');
    expect(pdf).toContain("(Qo'ng'iroqlar: 848) Tj");
    expect(pdf).toContain('(Yangi sotuvlar: 4) Tj');
    expect(pdf).toContain('(Suhbat davomiyligi: 13:35:00) Tj');
    expect(pdf).toContain('(Konversiya: 2.16%) Tj');
    expect(pdf).toContain('(Online/Offline/Intensiv sotuvlar: 0/0/4) Tj');
    expect(pdf).not.toContain('Konversiya \\(sotuv -> lid\\)');
  });

  it('paginates manager groups without dropping or duplicating rows', () => {
    const onlineRows = Array.from({ length: 30 }, (_, index) => (
      createManagerRow(`Online-${String(index).padStart(2, '0')}`, 'online', {
        leads: 60 - index,
        sales: 30 - index,
      })
    ));
    const offlineRows = Array.from({ length: 30 }, (_, index) => (
      createManagerRow(`Offline-${String(index).padStart(2, '0')}`, 'offline', {
        leads: 60 - index,
        sales: 30 - index,
      })
    ));
    const pdf = createPdf(createMetrics({ managerRows: [...onlineRows, ...offlineRows] }));
    const pageCount = Number(pdf.match(/\/Type \/Pages .*\/Count (\d+)/)?.[1] || 0);

    expect(pageCount).toBeGreaterThan(1);
    expect(pdf).toContain("Menejerlar bo'yicha sotuvlar \\(davomi\\)");
    expect(pdf).toContain('(Online agentlar) Tj');
    expect(pdf).toContain('(Offline agentlar) Tj');
    for (const row of [...onlineRows, ...offlineRows]) {
      expect(pdf.split(`(${row.name}) Tj`)).toHaveLength(2);
    }
  });
});
