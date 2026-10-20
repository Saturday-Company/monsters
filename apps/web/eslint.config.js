// @ts-check
// ESLint looks up the config from each file's directory: this one extends the root
// config with browser globals and the React hooks rules for the web UI.
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import root from '../../eslint.config.js';

export default [
  ...root,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['src/**/*.tsx', 'src/**/*.ts'],
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    // Type scale (docs/design.md): sizes come from the `text-micro..text-hero` tokens, never
    // from an arbitrary `text-[13px]`.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/text-\\[[0-9.]+px\\]/]',
          message:
            'Use a type-scale class (text-micro, text-caption, ... text-hero), not text-[Npx].',
        },
        {
          selector: 'TemplateElement[value.raw=/text-\\[[0-9.]+px\\]/]',
          message:
            'Use a type-scale class (text-micro, text-caption, ... text-hero), not text-[Npx].',
        },
      ],
    },
  },
  {
    files: ['e2e/**/*.ts', 'test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
];
