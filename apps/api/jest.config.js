/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // One worker per core leaves no headroom: with ~20 workers finishing at once on Windows, a worker can miss
  // jest-worker's 500 ms exit deadline and be reported as 'failed to exit gracefully' although nothing leaked.
  maxWorkers: '50%',
  testMatch: ['**/__tests__/**/*.test.ts'],
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
