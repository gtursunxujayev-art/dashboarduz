import {
  normalizePercentage,
  createZeroBreakdown,
  normalizeSalaryTier,
  isValidTierSequence,
  normalizeCategoryBonusRule,
  resolveBonusPercent,
  getBonusAmount,
  classifyCourseCategory,
  classifyCourseCategoryFromField,
  extractSalarySettings,
  toFiniteNumber,
  toPositiveInteger,
  isAgentOnly,
  isFinanceOnly,
  isTashkiliyOnly,
  type SalaryRuleTier,
} from '../dashboard/helpers';

describe('normalizePercentage', () => {
  it('returns 0 for non-numeric input', () => {
    expect(normalizePercentage(null)).toBe(0);
    expect(normalizePercentage(undefined)).toBe(0);
    expect(normalizePercentage('abc')).toBe(0);
  });

  it('clamps to 0-100 range', () => {
    expect(normalizePercentage(-5)).toBe(0);
    expect(normalizePercentage(150)).toBe(100);
  });

  it('normalizes valid percentages', () => {
    expect(normalizePercentage(50)).toBe(50);
    expect(normalizePercentage(10.555)).toBe(10.55);
    expect(normalizePercentage('25')).toBe(25);
  });
});

describe('toFiniteNumber', () => {
  it('returns number for valid input', () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber('3.14')).toBe(3.14);
  });

  it('returns fallback for invalid input', () => {
    expect(toFiniteNumber(null)).toBe(0);
    expect(toFiniteNumber(undefined)).toBe(0);
    expect(toFiniteNumber(NaN)).toBe(0);
    expect(toFiniteNumber(Infinity)).toBe(0);
    expect(toFiniteNumber('abc', 99)).toBe(99);
  });
});

describe('toPositiveInteger', () => {
  it('returns positive integers', () => {
    expect(toPositiveInteger(5)).toBe(5);
    expect(toPositiveInteger(3.9)).toBe(3);
  });

  it('returns 0 for non-positive', () => {
    expect(toPositiveInteger(-1)).toBe(0);
    expect(toPositiveInteger(0)).toBe(0);
    expect(toPositiveInteger(null)).toBe(0);
  });
});

describe('createZeroBreakdown', () => {
  it('returns all zero categories', () => {
    const result = createZeroBreakdown();
    expect(result).toEqual({ online: 0, offline: 0, intensive: 0 });
  });
});

describe('normalizeSalaryTier', () => {
  it('returns null for invalid input', () => {
    expect(normalizeSalaryTier(null)).toBeNull();
    expect(normalizeSalaryTier({})).toBeNull();
    expect(normalizeSalaryTier({ minSales: 0, percent: 10 })).toBeNull();
  });

  it('returns null when maxSales < minSales', () => {
    expect(normalizeSalaryTier({ minSales: 10, maxSales: 5, percent: 10 })).toBeNull();
  });

  it('parses valid tier', () => {
    const result = normalizeSalaryTier({ minSales: 5, maxSales: 10, percent: 15 });
    expect(result).toEqual({ minSales: 5, maxSales: 10, percent: 15 });
  });

  it('allows null maxSales (unbounded)', () => {
    const result = normalizeSalaryTier({ minSales: 5, maxSales: null, percent: 20 });
    expect(result).toEqual({ minSales: 5, maxSales: null, percent: 20 });
  });
});

describe('isValidTierSequence', () => {
  it('returns false for empty array', () => {
    expect(isValidTierSequence([])).toBe(false);
  });

  it('returns true for single tier with null maxSales', () => {
    const tiers: SalaryRuleTier[] = [{ minSales: 1, maxSales: null, percent: 10 }];
    expect(isValidTierSequence(tiers)).toBe(true);
  });

  it('returns true for valid ascending sequence', () => {
    const tiers: SalaryRuleTier[] = [
      { minSales: 1, maxSales: 5, percent: 5 },
      { minSales: 6, maxSales: 10, percent: 10 },
      { minSales: 11, maxSales: null, percent: 15 },
    ];
    expect(isValidTierSequence(tiers)).toBe(true);
  });

  it('returns false when null maxSales is not last', () => {
    const tiers: SalaryRuleTier[] = [
      { minSales: 1, maxSales: null, percent: 5 },
      { minSales: 6, maxSales: 10, percent: 10 },
    ];
    expect(isValidTierSequence(tiers)).toBe(false);
  });

  it('returns false for overlapping tiers', () => {
    const tiers: SalaryRuleTier[] = [
      { minSales: 1, maxSales: 10, percent: 5 },
      { minSales: 8, maxSales: null, percent: 10 },
    ];
    expect(isValidTierSequence(tiers)).toBe(false);
  });
});

describe('normalizeCategoryBonusRule', () => {
  it('returns simple rule for null input', () => {
    const result = normalizeCategoryBonusRule(null, 10);
    expect(result.mode).toBe('simple');
    expect(result.simplePercent).toBe(10);
  });

  it('parses tiered rule with valid tiers', () => {
    const result = normalizeCategoryBonusRule({
      mode: 'tiered',
      simplePercent: 5,
      tiers: [
        { minSales: 1, maxSales: 5, percent: 5 },
        { minSales: 6, maxSales: null, percent: 10 },
      ],
    }, 5);
    expect(result.mode).toBe('tiered');
    expect(result.tiers).toHaveLength(2);
  });

  it('falls back to simple when tiers are invalid', () => {
    const result = normalizeCategoryBonusRule({
      mode: 'tiered',
      simplePercent: 8,
      tiers: [],
    }, 8);
    expect(result.mode).toBe('simple');
  });
});

describe('resolveBonusPercent', () => {
  it('returns simplePercent for simple mode', () => {
    const rule = { mode: 'simple' as const, simplePercent: 12, tiers: [] };
    expect(resolveBonusPercent(rule, 5)).toBe(12);
  });

  it('returns 0 for tiered mode with 0 sales', () => {
    const rule = {
      mode: 'tiered' as const,
      simplePercent: 0,
      tiers: [{ minSales: 1, maxSales: null, percent: 10 }],
    };
    expect(resolveBonusPercent(rule, 0)).toBe(0);
  });

  it('matches correct tier', () => {
    const rule = {
      mode: 'tiered' as const,
      simplePercent: 0,
      tiers: [
        { minSales: 1, maxSales: 5, percent: 5 },
        { minSales: 6, maxSales: 10, percent: 10 },
        { minSales: 11, maxSales: null, percent: 15 },
      ],
    };
    expect(resolveBonusPercent(rule, 3)).toBe(5);
    expect(resolveBonusPercent(rule, 8)).toBe(10);
    expect(resolveBonusPercent(rule, 20)).toBe(15);
  });
});

describe('getBonusAmount', () => {
  it('calculates bonus correctly', () => {
    expect(getBonusAmount(1000, 10)).toBe(100);
    expect(getBonusAmount(1500, 15)).toBe(225);
  });

  it('returns 0 for zero/negative inputs', () => {
    expect(getBonusAmount(0, 10)).toBe(0);
    expect(getBonusAmount(1000, 0)).toBe(0);
    expect(getBonusAmount(-100, 10)).toBe(0);
  });
});

describe('classifyCourseCategory', () => {
  it('classifies online variants', () => {
    expect(classifyCourseCategory('Python Online')).toBe('online');
    expect(classifyCourseCategory('Onlayn kurs')).toBe('online');
    expect(classifyCourseCategory('Курс Онлайн')).toBe('online');
  });

  it('classifies offline variants', () => {
    expect(classifyCourseCategory('Offline Python')).toBe('offline');
    expect(classifyCourseCategory('Oflayn')).toBe('offline');
    expect(classifyCourseCategory('Офлайн курс')).toBe('offline');
  });

  it('classifies intensive variants', () => {
    expect(classifyCourseCategory('Intensive course')).toBe('intensive');
    expect(classifyCourseCategory('Intensiv')).toBe('intensive');
    expect(classifyCourseCategory('Интенсив')).toBe('intensive');
  });

  it('returns other for unrecognized', () => {
    expect(classifyCourseCategory('Regular course')).toBe('other');
    expect(classifyCourseCategory(null)).toBe('other');
    expect(classifyCourseCategory('')).toBe('other');
  });
});

describe('classifyCourseCategoryFromField', () => {
  it('returns exact match for canonical values', () => {
    expect(classifyCourseCategoryFromField('online')).toBe('online');
    expect(classifyCourseCategoryFromField('offline')).toBe('offline');
    expect(classifyCourseCategoryFromField('intensive')).toBe('intensive');
  });

  it('falls back to classifyCourseCategory for non-canonical', () => {
    expect(classifyCourseCategoryFromField('Onlayn')).toBe('online');
    expect(classifyCourseCategoryFromField('unknown')).toBe('other');
  });
});

describe('role checks', () => {
  describe('isAgentOnly', () => {
    it('returns true for Agent without privileged roles', () => {
      expect(isAgentOnly(['Agent'])).toBe(true);
      expect(isAgentOnly(['Agent', 'Tashkiliy'])).toBe(true);
    });

    it('returns false when combined with privileged roles', () => {
      expect(isAgentOnly(['Agent', 'Admin'])).toBe(false);
      expect(isAgentOnly(['Agent', 'Manager'])).toBe(false);
      expect(isAgentOnly(['Agent', 'Finance'])).toBe(false);
    });

    it('returns false without Agent', () => {
      expect(isAgentOnly(['Admin'])).toBe(false);
    });
  });

  describe('isFinanceOnly', () => {
    it('returns true for Finance without other main roles', () => {
      expect(isFinanceOnly(['Finance'])).toBe(true);
    });

    it('returns false with Admin/Manager/Agent', () => {
      expect(isFinanceOnly(['Finance', 'Admin'])).toBe(false);
      expect(isFinanceOnly(['Finance', 'Agent'])).toBe(false);
    });
  });

  describe('isTashkiliyOnly', () => {
    it('returns true for Tashkiliy only', () => {
      expect(isTashkiliyOnly(['Tashkiliy'])).toBe(true);
    });

    it('returns false with any other main role', () => {
      expect(isTashkiliyOnly(['Tashkiliy', 'Admin'])).toBe(false);
      expect(isTashkiliyOnly(['Tashkiliy', 'Finance'])).toBe(false);
    });
  });
});

describe('extractSalarySettings', () => {
  it('returns defaults for null/empty input', () => {
    const result = extractSalarySettings(null);
    expect(result.bonusMode).toBe('on_income');
    expect(result.bonusPercentages).toEqual({ online: 0, offline: 0, intensive: 0 });
    expect(result.fixedSalaries.size).toBe(0);
    expect(result.planBonuses).toHaveLength(0);
  });

  it('parses valid settings', () => {
    const result = extractSalarySettings({
      salary: {
        bonusMode: 'on_debt_closed',
        bonusPercentages: { online: 10, offline: 15, intensive: 20 },
        fixedSalaries: [
          { userId: 'user-1', amount: 5000000 },
          { userId: 'user-2', amount: 3000000 },
        ],
        planBonuses: [
          {
            id: 'plan-1',
            name: 'Online bonus',
            isActive: true,
            periodMode: 'monthly',
            courseCategory: 'online',
            targetClosedSales: 10,
            bonusAmount: 500000,
          },
        ],
      },
    });
    expect(result.bonusMode).toBe('on_debt_closed');
    expect(result.bonusPercentages.online).toBe(10);
    expect(result.bonusPercentages.offline).toBe(15);
    expect(result.bonusPercentages.intensive).toBe(20);
    expect(result.fixedSalaries.get('user-1')).toBe(5000000);
    expect(result.fixedSalaries.get('user-2')).toBe(3000000);
    expect(result.planBonuses).toHaveLength(1);
    expect(result.planBonuses[0]!.name).toBe('Online bonus');
  });
});
