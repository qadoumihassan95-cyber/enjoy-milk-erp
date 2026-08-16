/**
 * Jest config for @qadoumi/erp-ai-core.
 *
 * All test tooling (jest, ts-jest, @types/jest) is declared in this
 * package's own devDependencies. No cross-workspace paths — this file
 * can be copied to a fresh repository unchanged.
 */

/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', isolatedModules: true }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 15000,
};
