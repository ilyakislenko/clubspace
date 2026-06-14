import nx from '@nx/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nx.configs['flat/react'],
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // jsx-a11y/accessible-emoji is a deprecated, DOM-only rule: it wants
      // emoji wrapped in <span role="img" aria-label>, which is meaningless
      // in React Native. RN accessibility is expressed via accessibilityLabel
      // / accessibilityRole and decorative elements via accessibilityElements-
      // Hidden, which this app uses instead.
      'jsx-a11y/accessible-emoji': 'off',
    },
  },
  {
    ignores: ['.expo', 'web-build', 'cache', 'dist', '**/out-tsc'],
  },
];
