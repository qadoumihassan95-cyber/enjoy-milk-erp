/**
 * Jest config for the Enjoy Milk API (NestJS).
 *
 * Runs every *.spec.ts / *.test.ts under apps/api/src. Uses ts-jest in
 * isolatedModules mode — fast for unit tests, and matches the tsconfig
 * already used at build time. Nest decorator metadata is not evaluated
 * here because tests target plain service methods with mocked Prisma.
 */
const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: path.join(__dirname, 'tsconfig.json'),
      isolatedModules: true,
    }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 20000,
};
