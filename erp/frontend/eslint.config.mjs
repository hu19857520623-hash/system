import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'src/auto-imports.d.ts', 'src/components.d.ts'] },
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        fetch: 'readonly',
        btoa: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        File: 'readonly',
        MessageEvent: 'readonly',
        setTimeout: 'readonly',
      },
    },
    plugins: {
      vue,
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'no-debugger': 'error',
      'no-constant-binary-expression': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'vue/no-mutating-props': 'error',
      'vue/no-use-v-if-with-v-for': 'error',
    },
  },
]
