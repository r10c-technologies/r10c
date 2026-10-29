/**
 * What a slice declares it serves, against what its shell serves
 * ([ADR 0071](../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 *
 * A declaration's `exposedAPIs` entry names one path and every method on it —
 * `'GET|POST /api/product-order'`, or several paths with a brace group —
 * `'GET /api/x{,/:id}'` — and a served endpoint is one method and one path, so
 * both sides are expanded to `METHOD /path` before they are compared.
 */
export const expandApis = (declared: readonly string[]): string[] =>
  declared
    .flatMap(entry => {
      const [methods = '', path = ''] = entry.split(' ');
      return methods
        .split('|')
        .flatMap(method => expandBraces(path).map(one => `${method} ${one}`));
    })
    .sort();

/** `/api/x{,/:id}` as `/api/x` and `/api/x/:id` — one group, as the register writes it. */
const expandBraces = (path: string): string[] => {
  const match = /\{([^}]*)\}/.exec(path);
  if (match === null) return [path];
  const [group, alternatives = ''] = match;
  return alternatives
    .split(',')
    .flatMap(alternative => expandBraces(path.replace(group, alternative)));
};

/** Which declared endpoints nothing serves, and which served ones nothing declares. */
export const endpointDrift = (
  declared: readonly string[],
  served: readonly string[],
): { readonly missing: string[]; readonly extra: string[] } => {
  const expanded = new Set(expandApis(declared));
  const actual = new Set(served);
  return {
    missing: [...expanded].filter(endpoint => !actual.has(endpoint)).sort(),
    extra: [...actual].filter(endpoint => !expanded.has(endpoint)).sort(),
  };
};
