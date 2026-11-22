const nextJest = require('next/jest.js');

const createJestConfig = nextJest({
  // The app root, not the cwd: nx runs jest from the workspace root.
  dir: __dirname,
});

const config = {
  displayName: '@clubspace/client',
  preset: '../../jest.preset.js',
  transform: {
    '^(?!.*\\.(js|jsx|ts|tsx|css|json)$)': '@nx/react/plugins/jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '../../coverage/apps/client',
  testEnvironment: 'jsdom',
};

module.exports = createJestConfig(config);
