/**
 * **tax-policy** — the fiscal vocabulary and the one IVA function, and nothing
 * else.
 *
 * `business:policy`, as `sales-vocabulary` is: several domains express
 * themselves in it and none of them may see another. The organization declares
 * its regime, the order stores each line's tax, payment stores each
 * allocation's share of it and a refund mirrors that share — four records in
 * three domains, and one rule for what the numbers are
 * ([ADR 0078](../../../../docs/adr/0078-a-new-module-joins-through-complete-events-and-starts-from-a-snapshot.md) §6).
 *
 * The tax is **computed once, by the coordinator, and stored by every
 * participant** — never recomputed by a consumer, exactly as `commissionFor`
 * is. A rate is a configuration row the coordinator reads (`tax` group), never
 * a constant here: what this package fixes is the arithmetic, a rate is a fact
 * about the law.
 *
 * ⚠️ **Vocabulary and arithmetic only — no `*_DOMAIN` constant, no entity.** A
 * domain constant here would have to be claimed by a slice, and this package
 * owns no store.
 */
export * from './values';
