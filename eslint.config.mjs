import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      // Uploaded files and video renditions on the free setup (STORAGE_DIR).
      '**/var/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs', '*.cjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // The service worker runs in the browser's service worker scope.
    files: ['apps/web/public/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // k6 load profiles run in k6's runtime, which provides these globals (load/README.md).
    files: ['load/**/*.js'],
    languageOptions: {
      globals: { open: 'readonly', __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' },
    },
  },
  {
    // All user-facing text comes from translation files (REQ-I18N-002, CLAUDE.md).
    files: ['apps/web/**/*.tsx'],
    plugins: { react },
    settings: { react: { version: 'detect' } },
    rules: {
      // Punctuation used as separators isn't text to translate.
      'react/jsx-no-literals': [
        'error',
        { noStrings: true, ignoreProps: true, allowedStrings: [' ', '·', ' ·'] },
      ],
    },
  },
  {
    // Server code logs through the structured logger, never console (logs must not leak personal data).
    files: ['apps/api/src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
);
