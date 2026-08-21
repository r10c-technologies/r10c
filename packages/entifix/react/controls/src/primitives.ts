// The entity-free half of the design system, published as
// `@r10c/entifix-react-controls/primitives`.
//
// It exists because the package's main barrel is one flat re-export of
// everything, and a bundler cannot drop what a module graph reaches: a
// storefront page importing `Card` from `.` pulled `EntityTable`,
// `FilterBuilder`, `SortBuilder`, `ColumnSettings` and the RSQL machinery
// behind them into its client bundle — 541 KB of back-office UI shipped to a
// visitor looking at a product.
//
// The line drawn here is not "small vs large", it is **presentational vs
// entity-aware**: everything below can be understood without knowing what an
// entity is. Anything that reads entity metadata (`CellValue`, `FieldControl`,
// `EntityTable`, `EntityForm`, the filter/sort/column builders, the link
// inputs) stays behind the main entry, where the back-office already imports it.
//
// Consumers that need both may import both; nothing is duplicated, and the main
// barrel keeps re-exporting all of this so no existing import breaks.

// Providers every app mounts, whatever it renders.
//
// `./preferences` is deliberately **not** here. The UI-preferences store is
// backed by Effect `Layer`s, so re-exporting it drags the whole Effect runtime
// into the browser — and what it remembers (column visibility, table density)
// only exists in the back-office. A storefront has no preferences to store.
export * from './i18n';
export * from './theme';

// Atoms — text, buttons, fields, tables, loading placeholders.
export * from './ui/atoms/button';
export * from './ui/atoms/field';
export * from './ui/atoms/skeleton';
export * from './ui/atoms/table';
export * from './ui/atoms/text';

// Layout primitives (Every Layout): flex-first, with `Grid` the one CSS-Grid
// escape hatch.
export * from './ui/layout/box';
export * from './ui/layout/center';
export * from './ui/layout/cluster';
export * from './ui/layout/cover';
export * from './ui/layout/grid';
export * from './ui/layout/sidebar';
export * from './ui/layout/switcher';

// Molecules that compose the above and nothing else.
export * from './ui/molecules/breadcrumbs';
export * from './ui/molecules/card';
export * from './ui/molecules/confirm-dialog';
export * from './ui/molecules/loading-boundary';
export * from './ui/molecules/menu';
export * from './ui/molecules/pagination';
export * from './ui/molecules/stack';
export * from './ui/molecules/tab-strip';
export * from './ui/molecules/theme-switcher';
export * from './ui/utils/cn';
