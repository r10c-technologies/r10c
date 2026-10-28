/**
 * The `config` slice's shell: the configuration store's routes and the
 * composition behind them — Postgres, the migration and seed, the lookup every
 * other service boots from, and the token verification its CRUD needs.
 * config-service only mounts it, handing in its seed rows (ADR 0064).
 */
export {
  type ConfigShellOptions,
  type ConfigurationRow,
  makeAppLayer,
} from './app-layer.js';
export { router } from './router.js';
