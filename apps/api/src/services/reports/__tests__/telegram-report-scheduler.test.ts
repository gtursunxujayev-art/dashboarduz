import type { ManagerGroup } from '@dashboarduz/shared';

import {
  classifyManagerGroup,
  compareManagerRows,
  getBreakdownLayout,
  groupManagerRows,
} from '../telegram-report/format';
import { extractPdfText, PdfCanvas } from '../telegram-report/pdf-canvas';
import { createStyledReportPdf } from '../telegram-report/report-pdf';
import type { ReportManagerRow, ReportMetrics } from '../telegram-report/types';
import { resolveReportWindows } from '../telegram-report/windows';

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
    callCount: 0,
    longCallCount: 0,
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

function createPdfBuffer(metrics: ReportMetrics, tenantName = 'Najot Nur'): Buffer {
  return createStyledReportPdf({
    tenantName,
    title: 'Kunlik hisobot (Kecha)',
    periodStart: new Date('2026-07-23T19:00:00.000Z'),
    periodEnd: new Date('2026-07-24T18:59:59.999Z'),
    generatedAt: new Date('2026-07-25T03:00:00.000Z'),
    metrics,
  });
}

function createPdf(metrics: ReportMetrics): string {
  return createPdfBuffer(metrics).toString('latin1');
}

describe('Telegram report schedule', () => {
  const dailyWindows = (iso: string) => resolveReportWindows(new Date(iso)).filter((window) => window.kind === 'daily');

  it('sends the daily report for yesterday from 10:00 Tashkent time', () => {
    expect(dailyWindows('2026-11-17T04:59:59.000Z')).toEqual([]); // 09:59:59 Tashkent
    const [daily] = dailyWindows('2026-11-17T05:00:00.000Z'); // 10:00 Tashkent

    expect(daily?.periodKey).toBe('2026-11-16');
    expect(daily?.periodStart.toISOString()).toBe('2026-11-15T19:00:00.000Z');
    expect(daily?.periodEnd.toISOString()).toBe('2026-11-16T18:59:59.999Z');
  });
});

describe('Telegram report manager grouping', () => {
  it('classifies explicit agent roles and gives OnlineAgent precedence', () => {
    expect(classifyManagerGroup(['OnlineAgent'])).toBe('online');
    expect(classifyManagerGroup(['OfflineAgent'])).toBe('offline');
    expect(classifyManagerGroup(['OfflineAgent', 'OnlineAgent'])).toBe('online');
  });

  it('lists team leaders with the offline managers', () => {
    expect(classifyManagerGroup(['TeamLeader'])).toBe('offline');
    expect(classifyManagerGroup(['TeamLeader', 'OnlineAgent'])).toBe('online');
  });

  it('excludes generic and non-agent roles', () => {
    expect(classifyManagerGroup(['Agent'])).toBeNull();
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
        label: 'Onlayn agentlar',
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
    const text = extractPdfText(createPdfBuffer(createMetrics()));
    const cardRectangles = pdf
      .split('\n')
      .filter((line) => / (160|78) 54 re$/.test(line));

    expect(cardRectangles).toHaveLength(7);
    expect(text).toContain('Sifatsiz lidlar: 14');
    expect(text).toContain("Qo'ng'iroqlar: 848");
    expect(text).toContain('Yangi sotuvlar: 4');
    expect(text).toContain('Suhbat davomiyligi: 13:35:00');
    expect(text).toContain('Konversiya: 2.16%');
    expect(text).toContain('Onlayn/Oflayn/Intensiv sotuvlar: 0/0/4');
    expect(text.join('\n')).not.toContain('Konversiya (sotuv -> lid)');
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
    const buffer = createPdfBuffer(createMetrics({ managerRows: [...onlineRows, ...offlineRows] }));
    const pdf = buffer.toString('latin1');
    const text = extractPdfText(buffer);
    const pageCount = Number(pdf.match(/\/Type \/Pages .*\/Count (\d+)/)?.[1] || 0);

    expect(pageCount).toBeGreaterThan(1);
    expect(text).toContain("Menejerlar bo'yicha sotuvlar (davomi)");
    expect(text).toContain('Onlayn agentlar');
    expect(text).toContain('Oflayn agentlar');
    for (const row of [...onlineRows, ...offlineRows]) {
      expect(text.filter((run) => run === row.name)).toHaveLength(1);
    }
  });

  it('shows per-manager call counts and 4+ minute calls', () => {
    const text = extractPdfText(createPdfBuffer(createMetrics({
      managerRows: [createManagerRow('Sabina', 'offline', { callCount: 57, longCallCount: 9, callDurationSeconds: 3420 })],
    })));
    const nameIndex = text.indexOf('Sabina');

    expect(text).toContain("Qo'ng'iroq");
    expect(text).toContain('4+ daq');
    expect(text.slice(nameIndex, nameIndex + 12)).toEqual(expect.arrayContaining(['57', '9', '00:57']));
  });
});

describe('Telegram report text rendering', () => {
  it('keeps Cyrillic and Uzbek apostrophe letters instead of replacing them with "?"', () => {
    const text = extractPdfText(createPdfBuffer(createMetrics({
      managerRows: [createManagerRow('Абдуллаев Шерзод', 'online'), createManagerRow('Gʻulom Oʻgʻiloy', 'online')],
      sourceBreakdown: [{ label: 'Сайт', value: 3 }],
    }), 'Najot Taʼlim'));

    expect(text).toContain('Najot Taʼlim');
    expect(text).toContain('Абдуллаев Шерзод');
    expect(text).toContain('Gʻulom Oʻgʻiloy');
    expect(text.join('\n')).not.toMatch(/\?{2,}/);
  });

  it('embeds the font and stays a well-formed PDF', () => {
    const pdf = createPdf(createMetrics());

    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/FontFile2');
    expect(pdf).toContain('/Encoding /Identity-H');
    expect(pdf).toContain('/ToUnicode');
    const startXref = Number(pdf.match(/startxref\n(\d+)\n%%EOF$/)?.[1]);

    expect(pdf.slice(startXref, startXref + 4)).toBe('xref');
  });

  it('shortens text that does not fit its column', () => {
    const canvas = new PdfCanvas();
    const longName = 'Gʻulomova Oʻgiloy Baxtiyorovna Abdullayevna';
    const fitted = canvas.fit(longName, 76, { size: 7.2 });

    expect(fitted.endsWith('…')).toBe(true);
    expect(canvas.measure(fitted, { size: 7.2 })).toBeLessThanOrEqual(76);
    expect(canvas.fit('Sabina', 76, { size: 7.2 })).toBe('Sabina');
  });
});
