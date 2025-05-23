const resolve = require('@rollup/plugin-node-resolve').default;
const commonjs = require('@rollup/plugin-commonjs');
const typescript = require('@rollup/plugin-typescript');
const json = require('@rollup/plugin-json');

const isProduction = process.env.BUILD === 'production';

module.exports = [
  {
    input: 'src/extension.ts',
    output: {
      file: 'lib/extension.js',
      format: 'cjs',
      sourcemap: true
    },
    external: ['vscode'],
    plugins: [
      resolve({ preferBuiltins: true }),
      commonjs(),
      json(),
      typescript({ tsconfig: './tsconfig.json' })
    ]
  },
  {
    input: 'src/server.ts',
    output: {
      file: 'lib/server.js',
      format: 'cjs',
      sourcemap: true
    },
    external: [
      'vscode-languageserver/node',
      'toml',
      'tree-sitter',
      'tree-sitter-jinja'
    ],
    plugins: [
      resolve({ preferBuiltins: true }),
      commonjs(),
      json(),
      typescript({ tsconfig: './tsconfig.json' })
    ]
  }
]; 