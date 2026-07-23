// Storybook's Vite builder resolves PostCSS from the package root. Same plugins
// the Next apps use so `@import 'tailwindcss'` + tokens compile identically.
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
