/**
 * The starter characteristic vocabulary, in the entity wire shape so it can be
 * inserted verbatim and read back through the entifix deserializer.
 *
 * Deliberately tiny. The dictionary is meant to **grow from usage** — the
 * free-form codes that turn out to recur across tenants are the candidates —
 * so seeding a large speculative vocabulary would be inventing the answer
 * before anyone has asked the question
 * ([ADR 0014](../../../docs/adr/0014-entity-specifications-and-the-characteristic-dictionary.md)).
 *
 * `size` and `colour` are here because they are the two facets every catalog
 * needs on day one; `weight` is here because it is the example of an **open**
 * term — a code and a unit with no enumerated values.
 */
export const dictionaryTermTempData = [
  {
    id: 'term-size',
    code: 'size',
    values: ['xs', 's', 'm', 'l', 'xl'],
  },
  {
    id: 'term-colour',
    code: 'colour',
    values: ['black', 'white', 'red', 'blue', 'green'],
  },
  {
    id: 'term-weight',
    code: 'weight',
    values: [],
    unit: 'g',
  },
] as const;
