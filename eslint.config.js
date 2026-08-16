import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
  },

  // ТЗ §4 и §12: симуляция обязана быть детерминированной.
  // Ни Math.random(), ни любого источника реального времени внутри sim/.
  // ТЗ §5: sim/ не импортирует ничего из render/, ui/, platform/.
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'sim/ детерминирована: реальное время запрещено.' },
        { name: 'performance', message: 'sim/ детерминирована: реальное время запрещено.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Используй Rng из sim/Rng.ts.' },
        { object: 'Date', property: 'now', message: 'sim/ детерминирована: реальное время запрещено.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/render/*', '**/ui/*', '**/platform/*'],
              message: 'sim/ не зависит от слоёв рендера, UI и платформы (ТЗ §5).',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['tests/**/*.ts', 'vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
);
