/**
 * **shells-effect-flow-catalog** — the fragment catalog and the recipes
 * composed from it (ADR 0065).
 *
 * A base shell (`shell:base`) because two kinds of shell need it:
 * transaction's, which composes and starts flows, and every slice shell whose
 * `$metadata` reports a flow-backed verb. A domain shell may import a base
 * shell, and this one imports no domain shell.
 */
export * from './catalog.js';
