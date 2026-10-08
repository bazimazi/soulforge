import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'coverage', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser }, ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      // Gameplay content uses dynamic "bags" (flags, statuses) by design; see src/game/types.ts.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // The simulation must stay headless: no DOM, UI, audio or renderer imports.
    files: ['src/game/**/*.ts', 'src/data/**/*.ts', 'src/core/**/*.ts'],
    ignores: ['src/core/input.ts', 'src/core/loop.ts', 'src/core/storage.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/ui/**', '**/audio/**', '**/render/renderer*', '**/render/webgl*', '**/render/sprites*'],
              message: 'Simulation code must not depend on presentation layers. Emit a GameEvent instead.',
            },
          ],
        },
      ],
    },
  },
  { files: ['scripts/**', 'e2e/**', '*.config.*'], languageOptions: { globals: { ...globals.node } } },
);
