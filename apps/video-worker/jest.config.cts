// Jest config for video-worker specs. main.ts connects to Redis, Postgres and
// S3 on import, so the logic worth testing lives in side-effect-free modules
// (probe.ts) and main.ts is left to the transcode smoke run.
module.exports = {
    displayName: '@clubspace/apps/video-worker',
    preset: '../../jest.preset.js',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.spec.ts'],
    transform: {
        '^.+\\.[tj]s$': [
            '@swc/jest',
            {
                // Inline config only, same as the admin jest setup.
                swcrc: false,
                jsc: { parser: { syntax: 'typescript' }, target: 'es2021' },
                module: { type: 'commonjs' },
            },
        ],
    },
    // The worker is ESM under nodenext, so its relative imports carry a .js
    // suffix that points at the compiled file; jest resolves the .ts source.
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    moduleFileExtensions: ['ts', 'js'],
    coverageDirectory: 'test-output/jest/coverage',

    // See the note in apps/server/jest.config.cts on listing sources
    // explicitly. main.ts is excluded for the reason given above.
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts'],

    // A ratchet, not a target — see the note in apps/server/jest.config.cts.
    coverageThreshold: {
        global: {
            statements: 98,
            branches: 96,
            functions: 100,
            lines: 100,
        },
    },
}
