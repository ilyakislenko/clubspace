// Jest config for admin specs. Pure-helper specs (*.spec.ts) run in the
// default node env; component render specs (*.spec.tsx) opt into jsdom via a
// per-file `@jest-environment jsdom` docblock. swc transforms both.
module.exports = {
  displayName: '@clubspace/apps/admin',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.spec.tsx'],
  transform: {
    '^.+\\.[tj]sx?$': [
      '@swc/jest',
      {
        // Ignore the app's ambient .swcrc (its `exclude` drops *.spec files,
        // which would leave jest unable to transform our specs); use only this
        // inline config — same trick as the server jest setup.
        swcrc: false,
        jsc: {
          parser: { syntax: 'typescript', tsx: true },
          // Automatic JSX runtime (same as the Next build) so component +
          // render specs don't need an explicit `import React`.
          transform: { react: { runtime: 'automatic' } },
          target: 'es2020',
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js'],
  coverageDirectory: 'test-output/jest/coverage',

  // See the note in apps/server/jest.config.cts: without an explicit source
  // list, jest instruments only the files a test imported, so screens with no
  // spec are invisible and the percentage describes the tested subset instead
  // of the app.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.spec.{ts,tsx}',
    // Generated from open-api.json; regenerating it is contract-gated in CI.
    '!src/shared/sdk/**',
    '!src/**/*.d.ts',
  ],

  // A ratchet, not a target — see the note in apps/server/jest.config.cts.
  // The admin app starts far lower than the server because most of it is
  // screens that had no render tests at all.
  coverageThreshold: {
    global: {
      statements: 14,
      branches: 14,
      functions: 12,
      lines: 14,
    },
  },
}
