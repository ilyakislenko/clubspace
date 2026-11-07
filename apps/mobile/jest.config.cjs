// Lean jest config for mobile pure-helper specs. We don't bring in the
// expo preset because the things we want to test (date math, schedule
// helpers, VTT parsing) are framework-free TypeScript — the heavier
// preset would cost ~3s of startup per run with no extra coverage.
module.exports = {
    displayName: '@clubspace/apps/mobile',
    preset: '../../jest.preset.js',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.spec.ts'],
    transform: {
        '^.+\\.[tj]sx?$': [
            '@swc/jest',
            {
                jsc: {
                    parser: { syntax: 'typescript', tsx: false },
                    target: 'es2020',
                },
            },
        ],
    },
    moduleFileExtensions: ['ts', 'tsx', 'js'],
    // react-native itself is Flow-typed ESM that this lean setup can't
    // transform; see the stub for why it throws on anything it doesn't cover.
    moduleNameMapper: {
        '^react-native$': '<rootDir>/jest/react-native-stub.js',
    },
    // Coverage over the framework-free helpers (.ts) this setup can test;
    // .tsx screens are out of reach of the lean transform and excluded.
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/*.d.ts'],
    // Ratchet just below the measured 60.6 / 65.3 / 52.2 / 59.4 % (2026-11-08):
    // raise it as helpers gain tests, never lower it to land a change.
    coverageThreshold: {
        global: { statements: 59, branches: 64, functions: 51, lines: 58 },
    },
}
