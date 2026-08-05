import { readFileSync } from 'fs'

const swcJestConfig = JSON.parse(
    readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
)
swcJestConfig.swcrc = false

export default {
    displayName: '@clubspace/apps/server',
    preset: '../../jest.preset.js',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.spec.ts'],
    transform: {
        '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],
    },
    moduleFileExtensions: ['ts', 'js', 'html'],
    coverageDirectory: 'test-output/jest/coverage',
    // Tests are pure unit specs against domain helpers and services —
    // we instantiate classes manually with jest mocks for Prisma. No
    // Nest test harness needed; that lives in server-e2e for real
    // HTTP-level integration coverage.
}
