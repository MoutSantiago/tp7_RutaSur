import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import prettier from 'eslint-config-prettier';

/**
 * Configuración flat de ESLint para el monorepo RutaSur.
 * Aplica las reglas recomendadas de ESLint y exige JSDoc en clases y funciones.
 */
export default [
  {
    ignores: ['node_modules/**', '**/node_modules/**', '**/dist/**', '**/.next/**'],
  },
  js.configs.recommended,
  prettier,
  {
    files: ['**/*.js'],
    plugins: { jsdoc },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        ReadableStream: 'readonly',
        TextEncoder: 'readonly',
        EventSource: 'readonly',
        fetch: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: false,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
        },
      ],
      'jsdoc/require-description': 'error',
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-param-name': 'error',
      'jsdoc/require-param-type': 'error',
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/require-returns-type': 'error',
      'jsdoc/check-alignment': 'error',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',
      'jsdoc/check-types': 'error',
    },
  },
];
