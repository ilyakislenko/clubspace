import { readFileSync } from 'fs'

const swcJestConfig = JSON.parse(
    readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8'),
)
swcJestConfig.swcrc = false

export default {
    displayName: '@clubspace/apps/server-e2e',
    preset: '../../jest.preset.js',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.e2e-spec.ts'],

    // Runs before the spec file is imported, i.e. before anything reads
    // environments/environment at module scope.
    setupFiles: ['<rootDir>/src/support/env.ts'],
    globalSetup: '<rootDir>/src/support/global-setup.ts',
    globalTeardown: '<rootDir>/src/support/global-teardown.ts',

    // Must repeat the nx preset's exact transform key. Jest merges the two
    // transform maps rather than replacing, and a narrower pattern of our own
    // would leave the preset's ts-jest entry matching first — which then tries
    // to compile the .ts sources otplib ships in node_modules against a
    // tsconfig that doesn't cover them.
    transform: {
        '^.+\\.(ts|js|mts|mjs|cts|cjs|html)$': ['@swc/jest', swcJestConfig],
    },
    // Unlike the server's unit specs, this suite imports the entire AppModule,
    // which drags in dependencies that ship ESM-only builds. node_modules is
    // untransformed by default, so those arrive as raw `export {...}` and jest
    // dies on the syntax. Transform the named offenders rather than all of
    // node_modules, which would cost seconds per run.
    transformIgnorePatterns: [
        // @prisma/client is here because Prisma 7 loads its query compiler as
        // a WASM-backed .mjs at connect time — an untransformed ESM module
        // reaching a CJS runtime, which fails inside PrismaService.onModuleInit
        // with a bare "Unexpected token 'export'" and no mention of Prisma.
        '/node_modules/(?!(uuid|otplib|@otplib|@scure|@noble|@prisma/client)/)',
    ],
    moduleFileExtensions: ['ts', 'js', 'mjs', 'cjs', 'html'],
    coverageDirectory: 'test-output/jest/coverage',

    // Every suite truncates shared tables in the one test database, so two
    // running in parallel would delete each other's fixtures mid-assertion.
    maxWorkers: 1,

    // Each spec file boots its own AppModule in a fresh module registry. A
    // passing file is collected afterwards, but a file with a failing test is
    // not — measured at ~95 MB retained per red file, whatever the failure. In
    // one long-lived process a broken run therefore died of V8 heap OOM around
    // the 40th file instead of reporting its failures. Setting this moves the
    // files into a single child worker (still one at a time — maxWorkers: 1)
    // that jest replaces whenever its heap is above the limit after a file, so
    // memory is bounded by one file, not by the suite. The heap ceiling for
    // that worker comes from NODE_OPTIONS in package.json `test:e2e`,
    // scripts/verify.sh and the CI e2e job.
    workerIdleMemoryLimit: '2GB',

    // Booting the whole AppModule (Prisma connect, BullMQ handshake, seeding)
    // costs a few seconds before the first assertion in a fresh suite.
    testTimeout: 30_000,
}
