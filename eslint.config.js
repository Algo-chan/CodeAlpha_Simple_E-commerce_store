import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/coverage/**',
      '**/dist/**',
      '**/build/**',
      'frontend/assets/**',
    ],
  },
  js.configs.recommended,
  prettier,

  // Shared rules for every JavaScript file in the repository.
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },

  // Backend + tooling: Node.js runtime (ESM).
  {
    files: ['backend/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Frontend: browser runtime (ES modules loaded by the browser).
  {
    files: ['frontend/js/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Frontend dev server: Node.js runtime.
  {
    files: ['frontend/server.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
