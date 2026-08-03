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
      // react-native-web renders a bare Pressable as a <div tabindex="-1">:
      // no keyboard focus, no Enter/Space, nothing for a screen reader. The
      // app's wrapper declares the role so RNW emits a real <button>.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Pressable'],
              message:
                "Import Pressable from 'shared/components/Pressable' — it gives web builds real button semantics (keyboard focus, Enter/Space, screen readers).",
            },
            {
              name: 'react-native',
              importNames: ['TextInput'],
              message:
                "Import TextInput from 'shared/components/TextInput' — it enforces the 16px minimum that stops iOS Safari zooming the page on focus.",
            },
          ],
        },
      ],
    },
  },
  {
    // The wrappers are the one place that may reach for the real thing. Matched
    // by suffix so the exemption holds however eslint is invoked (the flat
    // config resolves relative patterns against the cwd, not this file).
    files: [
      '**/shared/components/Pressable.tsx',
      '**/shared/components/TextInput.tsx',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    ignores: ['.expo', 'web-build', 'cache', 'dist', '**/out-tsc'],
  },
];
