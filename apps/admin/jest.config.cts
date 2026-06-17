// Jest config for admin specs. Pure-helper specs (*.spec.ts) run in the
// default node env; component render specs (*.spec.tsx) opt into jsdom via a
// per-file `@jest-environment jsdom` docblock. swc transforms both.
module.exports = {
  displayName: '@bjj-academy/apps/admin',
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
}
