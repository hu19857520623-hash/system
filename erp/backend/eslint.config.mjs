import tseslint from 'typescript-eslint'

export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts', 'prisma/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-debugger': 'error',
      'no-constant-binary-expression': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off'
    },
  },
]
