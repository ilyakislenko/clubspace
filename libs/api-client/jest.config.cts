// Lean jest config for the api-client lib's framework-free units (token
// store, etc.). Node env + swc, *.spec.ts only; swcrc:false so an ambient
// .swcrc can't exclude the specs. Mirrors the server/admin jest setup.
module.exports = {
  displayName: '@bjj-academy/api-client',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\\.[tj]sx?$': [
      '@swc/jest',
      {
        swcrc: false,
        jsc: {
          parser: { syntax: 'typescript', tsx: false },
          target: 'es2020',
        },
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js'],
}
