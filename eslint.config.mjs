import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
      "ignores": [
        "**/dist",
        "**/out-tsc"
      ]
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            // Build configs (tailwind, metro) read shared workspace files that
            // belong to no project; Nx 24 reports those as external resources.
            '^\\.\\./\\.\\./libs/ui-kit/util/tailwind\\.config$',
            '^\\.\\./\\.\\./tsconfig\\.base\\.json$',
          ],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    rules: {
      // `const { secret: _secret, ...rest } = row` is how the code omits a
      // field; the named sibling exists only to keep it out of `rest`.
      '@typescript-eslint/no-unused-vars': ['warn', { ignoreRestSiblings: true }],
      // Grouped empty `case` labels with a comment between them cannot fall
      // through into code by mistake; only a case with statements can.
      'no-fallthrough': ['warn', { allowEmptyCase: true }],
    },
  },
];
