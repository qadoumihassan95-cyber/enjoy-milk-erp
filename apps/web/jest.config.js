/**
 * Jest config for the web app.
 *
 * apps/web/lib/*.spec.ts existed but NO jest config matched them, so they
 * were never executed by any command. This wires them up alongside the new
 * numeric / error-normalisation regression tests.
 */
const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  rootDir: __dirname,
  testEnvironment: 'node',
  testMatch: ['<rootDir>/lib/**/*.spec.ts', '<rootDir>/lib/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.json'), isolatedModules: true }],
  },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  moduleFileExtensions: ['ts', 'js', 'json'],
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
};
