import next from 'eslint-config-next';
import prettier from 'eslint-config-prettier';

const config = [
  // brands/** = primitive brand (hex manifest disengaja, frontend §3.2)
  { ignores: ['.next/**', 'src/brand/**', 'brands/**', 'next-env.d.ts'] },
  ...next,
  {
    rules: {
      // Komponen hanya memakai token semantik (frontend §4, lint no-literal-colors).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/(#[0-9a-fA-F]{3,8}\\b|oklch\\(|rgb\\(|(bg|text|border)-\\[#)/]',
          message: 'Warna literal dilarang di komponen — pakai token semantik (globals.css).',
        },
      ],
    },
  },
  { files: ['test/**', 'scripts/**'], rules: { 'no-restricted-syntax': 'off' } },
  prettier,
];

export default config;
