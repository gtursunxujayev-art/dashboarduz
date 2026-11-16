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
  // Floors at the measured level (Nov 2026) so coverage cannot silently drop. The Postgres integration tests
  // (run when TEST_DATABASE_URL is set, as in CI) cover more, so they get their own, higher floor.
  coverageThreshold: {
    global: process.env.TEST_DATABASE_URL
      ? { statements: 20.7, branches: 12.1, functions: 18.3, lines: 20.9 }
      : { statements: 13.8, branches: 9.0, functions: 14.0, lines: 13.9 },
  },
  moduleNameMapper: {
    '^@dashboarduz/shared$': '<rootDir>/../../packages/shared/src',
    '^@dashboarduz/db$': '<rootDir>/../../packages/db/src',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(superjson|copy-anything|is-what)/)',
  ],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { useESM: false }],
  },
};
