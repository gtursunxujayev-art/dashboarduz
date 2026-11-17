/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // One worker per core leaves no headroom: with ~20 workers finishing at once on Windows, a worker can miss
  // jest-worker's 500 ms exit deadline and be reported as 'failed to exit gracefully' although nothing leaked.
  maxWorkers: '50%',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**', '!src/**/*.d.ts'],
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  // Floors at the measured level (Nov 2026, re-measured after the wave-1 merge) so coverage cannot silently drop. The Postgres integration tests
  // (run when TEST_DATABASE_URL is set, as in CI) cover more, so they get their own, higher floor.
  coverageThreshold: {
    global: process.env.TEST_DATABASE_URL
      ? { statements: 21.6, branches: 12.7, functions: 19.1, lines: 21.8 }
      : { statements: 14.5, branches: 9.5, functions: 14.7, lines: 14.6 },
  },
  moduleNameMapper: {
    '^@dashboarduz/shared$': '<rootDir>/../../packages/shared/src',
    '^@dashboarduz/db$': '<rootDir>/../../packages/db/src',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(superjson|copy-anything|is-what)/)',
  ],
  transform: {
    // tsconfig.jest.json maps the workspace packages to their source for type checking, as moduleNameMapper does
    // at runtime, so tests do not depend on a prior build of packages/db or packages/shared.
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
    '^.+\\.js$': ['ts-jest', { useESM: false, tsconfig: '<rootDir>/tsconfig.jest.json' }],
  },
};
