module.exports = {
  plugins: {
    // pnpm workspace root から Vitest Browser を起動しても、Panda がこの app の
    // config を解決できるよう基準ディレクトリを固定する。
    '@pandacss/dev/postcss': { cwd: __dirname },
  },
};
