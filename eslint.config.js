import js from '@eslint/js';
import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import prettierPlugin from 'eslint-plugin-prettier';
import vitestGlobalsPlugin from 'eslint-plugin-vitest-globals';

const { configs: jsConfigs } = js;
const globalIgnorePatterns = ['node_modules/**', 'dist/**', '*.d.ts'];

export default [
  // ESLint base configurations
  jsConfigs.recommended,

  // TypeScript plugin recommended configurations
  {
    files: ['**/*.{ts,tsx}'],
    ignores: globalIgnorePatterns,
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
        project: './tsconfig.json', // Only include the main tsconfig.json
      },
      globals: {
        window: true,
        document: true,
        Image: true, // Add Image to the global scope
        setTimeout: true, // Add setTimeout to the global scope
        clearTimeout: true, // Add clearTimeout to the global scope
        console: true, // Add console to the global scope
      },
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
    },
    rules: {
      ...typescriptPlugin.configs.recommended.rules,
      // Disable rules that are already handled by TypeScript
      'no-unused-vars': 'off', // Handled by @typescript-eslint/no-unused-vars
      '@typescript-eslint/no-unused-vars': ['error'], // Enable TypeScript version of no-unused-vars
    },
  },

  // Prettier configurations
  {
    files: ['**/*.{js,ts}'],
    ignores: globalIgnorePatterns,
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      ...prettierPlugin.configs.recommended.rules,
      'prettier/prettier': 'error',
    },
  },

  // Custom project-specific configurations
  {
    files: ['**/*.{js,ts}'],
    ignores: globalIgnorePatterns,
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
      },
      globals: {
        browser: true,
        es2021: true,
        node: true,
      },
    },
    plugins: {
      import: importPlugin,
      '@typescript-eslint': typescriptPlugin, // Ensure TypeScript plugin is available here as well
    },
    rules: {
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          pathGroups: [
            {
              pattern: '@/**',
              group: 'internal',
            },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
    },
  },

  // Vitest globals configurations
  {
    files: [
      '**/*.test.{js,ts}',
      '**/*.spec.{js,ts}',
      '**/__mocks__/**/*.{js,ts}',
    ],
    ignores: globalIgnorePatterns,
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    plugins: {
      vitestGlobals: vitestGlobalsPlugin,
    },
    rules: {
      'no-undef': 'off', // Disable the default no-undef rule
    },
  },
];
