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

    // Without this, jest instruments ONLY the files some test happened to
    // import — so a feature with no spec at all is invisible and the summary
    // reports the coverage of the tested subset as if it were the coverage of
    // the server. That read 84% while 100 of 152 handlers were never loaded by
    // a single test. Listing the sources explicitly makes untested files count
    // as 0% instead of not counting.
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.spec.ts',
        // Prisma's generated client: vendor output, not our code.
        '!src/infrastructure/prisma/generated/**',
        // Nest wiring with no branches to get wrong — a module listing its
        // providers is verified by the app booting, which is what the e2e
        // suite does. Counting it only inflates the denominator.
        '!src/**/*.module.ts',
        '!src/main.ts',
    ],

    // A ratchet, not a target. These are the real numbers as measured the day
    // collectCoverageFrom was added; the rule is that they only ever go up.
    // Raise them in the same commit that adds the tests — a threshold left
    // trailing far below actual coverage stops catching the case it exists
    // for, which is a new file arriving with no test at all.
    coverageThreshold: {
        global: {
            statements: 73,
            branches: 51,
            functions: 62,
            lines: 73,
        },
    },
}
