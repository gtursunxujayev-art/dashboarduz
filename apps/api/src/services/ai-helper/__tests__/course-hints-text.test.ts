import {
  buildCourseDirectAnswer,
  buildCourseSuggestionAnswer,
  levenshteinDistance,
  shouldPreferCourseDirectAnswer,
  similarityScore,
} from '../course-hints';

const hint = {
  requestedToken: '7-oqim',
  matchedCourseName: '7-Oqim',
  similarity: 0.8,
  salesCount: 3,
  agreementAmount: 12_345_678,
  incomeAmount: 1_500_000,
  debtAmount: 0,
  tariffBreakdown: [
    { tariff: 'Premium', salesCount: 2, agreementAmount: 0, incomeAmount: 0, debtAmount: 0 },
    { tariff: 'Standart', salesCount: 0, agreementAmount: 0, incomeAmount: 0, debtAmount: 0 },
    { tariff: 'VIP', salesCount: 1, agreementAmount: 0, incomeAmount: 0, debtAmount: 0 },
  ],
};

describe('course hint text helpers', () => {
  it('measures edit distance', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('oqim', 'oqim')).toBe(0);
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('7oqim', '7oqm')).toBe(1);
  });

  it('scores similarity between 0 and 1', () => {
    expect(similarityScore('', '')).toBe(1);
    expect(similarityScore('abcd', 'abcd')).toBe(1);
    expect(similarityScore('abcd', 'abce')).toBe(0.75);
    expect(similarityScore('ab', 'xyzw')).toBe(0);
  });

  it('prefers a direct answer for course and sales questions', () => {
    expect(shouldPreferCourseDirectAnswer('7-oqim KURSIGA nechta sotuv bor?')).toBe(true);
    expect(shouldPreferCourseDirectAnswer('Tarif boyicha')).toBe(true);
    expect(shouldPreferCourseDirectAnswer('Meta CTR qanday?')).toBe(false);
  });

  it('writes the direct answer with only the tariffs that sold', () => {
    expect(buildCourseDirectAnswer(hint)).toBe([
      "7-Oqimga 3 ta sotuv bo'lgan.",
      'Tariflar: Premium - 2 ta, VIP - 1 ta.',
      "Kelishuv summasi: 12 345 678 so'm.",
      "To'langan summasi: 1 500 000 so'm.",
      "Qarzdorlik summasi: 0 so'm.",
    ].join(' '));
    expect(buildCourseDirectAnswer({ ...hint, tariffBreakdown: [] })).toContain("Tariflar: tariflar bo'yicha sotuv topilmadi.");
  });

  it('suggests the matched course only when it is similar enough', () => {
    expect(buildCourseSuggestionAnswer(hint)).toBe(`Savolda yozuv xatolik bo'lishi mumkin. Balki "7-Oqim" ni nazarda tutdingizmi?`);
    expect(buildCourseSuggestionAnswer({ ...hint, similarity: 0.44 })).toBeNull();
    expect(buildCourseSuggestionAnswer({ ...hint, matchedCourseName: null })).toBeNull();
  });
});
