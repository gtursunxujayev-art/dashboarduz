import { groupRows, parseDateRange, summarizeComparisons } from '../comparison';
import { detectHeaderRow, detectMapping, type FinanceSnapshotRow, normalizeFinanceRows, normalizeHeader, type SnapshotMapping } from '../finance-snapshot';

const SHEET: Array<Array<string | number | boolean | null>> = [
  ['Moliya hisoboti', null, null],
  [],
  ['Sana', 'Telefon raqam', 'Mijoz ismi', 'Kurs', 'Tarif', "To'lov summasi", 'Qarzi', 'Kelishilgan narx'],
  ['2026-03-05T10:00:00', '+998 90 123-45-67', ' Ali  Valiyev ', 'Python', 'Standart', '1 200 000', '300 000', '1 500 000'],
  ['07.03.2026', '', 'Olim', 'Python', 'VIP', '500,5', '', ''],
  [null, null, null, null, null, null, null, null],
  ['08/03/2026', null, '', 'Python', null, 100, 0, 0],
  ['not a date', '998901234567', 'Ali Valiyev', 'Python', 'Standart', 'abc', 0, 0],
];

function mappingFor(rows: typeof SHEET): SnapshotMapping {
  const headerRow = rows[detectHeaderRow(rows)] ?? [];

  return detectMapping(headerRow.map((cell) => normalizeHeader(cell)));
}

describe('finance snapshot parsing', () => {
  it('normalizes headers: trims, lowercases and collapses whitespace', () => {
    expect(normalizeHeader("  To'lov   SUMMASI ")).toBe("to'lov summasi");
    expect(normalizeHeader(null)).toBe('');
    expect(normalizeHeader(42)).toBe('42');
  });

  it('picks the row with the most known headers among the first 12 rows', () => {
    expect(detectHeaderRow(SHEET)).toBe(2);
    expect(detectHeaderRow([])).toBe(0);
    expect(detectHeaderRow([['x'], ['y']])).toBe(0);
  });

  it('maps each field to the first header containing one of its aliases', () => {
    expect(mappingFor(SHEET)).toEqual({
      paymentDate: 0,
      customerPhone: 1,
      customerName: 2,
      telegramUsername: null,
      managerLabel: null,
      courseName: 3,
      tariffName: 4,
      subTariffName: null,
      paymentType: null,
      agreementAmount: 7,
      paymentAmount: 5,
      remainingDebtAmount: 6,
      deadline: null,
    });
  });

  it('normalizes data rows, skips blank ones and reports rows without a phone or name', () => {
    const mapping = mappingFor(SHEET);
    const { normalizedRows, errors } = normalizeFinanceRows(SHEET.slice(3), mapping);

    expect(errors).toEqual(['Qator 4: mijoz telefoni yoki ismi topilmadi.']);
    expect(normalizedRows).toHaveLength(3);
    expect(normalizedRows[0]).toEqual({
      rowIndex: 1,
      paymentDate: '2026-03-05',
      customerPhone: '+998 90 123-45-67',
      customerName: 'Ali  Valiyev',
      telegramUsername: '',
      managerLabel: '',
      courseName: 'Python',
      tariffName: 'Standart',
      subTariffName: '',
      paymentType: '',
      agreementAmount: 1_500_000,
      paymentAmount: 1_200_000,
      remainingDebtAmount: 300_000,
      deadline: null,
      normalizedPhone: '998901234567',
      normalizedName: 'ali valiyev',
    });
    expect(normalizedRows[1]).toMatchObject({ rowIndex: 2, paymentDate: '2026-03-07', paymentAmount: 500.5, normalizedPhone: '', normalizedName: 'olim' });
    expect(normalizedRows[2]).toMatchObject({ rowIndex: 5, paymentDate: null, paymentAmount: 0, normalizedPhone: '998901234567' });
  });
});

function financeRow(overrides: Partial<FinanceSnapshotRow>): FinanceSnapshotRow {
  return {
    rowIndex: 1,
    paymentDate: '2026-03-01',
    customerPhone: '',
    customerName: '',
    telegramUsername: '',
    managerLabel: '',
    courseName: '',
    tariffName: '',
    subTariffName: '',
    paymentType: '',
    agreementAmount: 0,
    paymentAmount: 0,
    remainingDebtAmount: 0,
    deadline: null,
    normalizedPhone: '',
    normalizedName: '',
    ...overrides,
  };
}

describe('income-problems comparison', () => {
  it('parses a Tashkent date range and rejects reversed or invalid ranges', () => {
    const { from, to } = parseDateRange('2026-03-01', '2026-03-31');

    expect(from.toISOString()).toBe('2026-02-28T19:00:00.000Z');
    expect(to.toISOString()).toBe('2026-03-31T18:59:59.999Z');
    expect(() => parseDateRange('2026-03-02', '2026-03-01')).toThrow();
    expect(() => parseDateRange('bad', '2026-03-01')).toThrow();
  });

  it('groups by phone when there is one, else by normalized name', () => {
    const groups = groupRows([
      financeRow({ customerPhone: '+998 90', normalizedPhone: '99890', customerName: '', paymentAmount: 100 }),
      financeRow({ customerPhone: '', normalizedPhone: '99890', customerName: 'Ali', normalizedName: 'ali', paymentAmount: 50 }),
      financeRow({ customerName: 'Vali', normalizedName: 'vali', paymentAmount: 10 }),
    ]);

    expect([...groups.keys()]).toEqual(['phone:99890', 'name:vali']);
    expect(groups.get('phone:99890')).toMatchObject({ phone: '+998 90', name: 'Ali', totalPaid: 150, paymentCount: 2 });
    expect(groups.get('name:vali')).toMatchObject({ totalPaid: 10, paymentCount: 1 });
  });

  it('matches by phone and classifies amount and count mismatches', () => {
    const db = groupRows([
      financeRow({ normalizedPhone: '111', customerPhone: '111', paymentAmount: 100 }),
      financeRow({ normalizedPhone: '222', customerPhone: '222', paymentAmount: 60 }),
      financeRow({ normalizedPhone: '222', customerPhone: '222', paymentAmount: 40 }),
      financeRow({ normalizedPhone: '333', customerPhone: '333', paymentAmount: 70 }),
    ]);
    const finance = groupRows([
      financeRow({ normalizedPhone: '111', customerPhone: '111', paymentAmount: 100 }),
      financeRow({ normalizedPhone: '222', customerPhone: '222', paymentAmount: 100 }),
      financeRow({ normalizedPhone: '333', customerPhone: '333', paymentAmount: 50 }),
    ]);
    const { rows, summary } = summarizeComparisons(db, finance);

    expect(summary).toMatchObject({
      dbTotal: 270,
      financeTotal: 250,
      differenceAmount: 20,
      matchedCustomers: 1,
      amountMismatchCount: 1,
    });
    // Largest absolute difference first; ties keep their phone-match order.
    expect(rows.map((row) => [row.matchId, row.status, row.differenceAmount])).toEqual([
      ['phone:333', 'amount_mismatch', 20],
      ['phone:111', 'matched', 0],
      ['phone:222', 'count_mismatch', 0],
    ]);
  });
});
