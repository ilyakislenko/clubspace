// Lean jest config for admin pure-helper specs. Like the mobile config, we
// keep it framework-free: the things worth unit-testing here are plain
// TypeScript (DnD grouping/ordering, drag-id routing, formatters), not React
// rendering — so a node env + swc transform is all we need.
module.exports = {
  displayName: '@bjj-academy/apps/admin',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
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
          target: 'es2020',
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js'],
}
