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
  // Floors just under the measured level (Plan D, Nov 2026: 79.6% lines without a database, 80.2% with one) so
  // coverage cannot silently drop. The Postgres integration tests (run when TEST_DATABASE_URL is set, as in CI) cover
  // more, so they get their own, higher floor.
  coverageThreshold: {
    global: process.env.TEST_DATABASE_URL
      ? { statements: 79, branches: 64.5, functions: 74, lines: 79.8 }
      : { statements: 78.5, branches: 63.5, functions: 73.5, lines: 79 },
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
