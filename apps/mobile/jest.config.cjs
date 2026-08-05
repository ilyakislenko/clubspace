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
}
