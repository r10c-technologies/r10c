import { DOMAINS } from './domains.js';
import { type Capability, STATUSES, VERTICALS } from './types.js';

/**
 * What the source tree says, reduced to the facts the register is checked
 * against. `world.ts` builds the real one; the spec builds doctored ones to
 * prove each check can fail.
 */
export interface World {
  /** Every `@useCase()`: its `<domain>:<entityKey>` resource, verb, and whether its package barrel reaches it. */
  readonly useCases: readonly {
    readonly resource: string;
    readonly key: string;
    readonly recipe?: string;
    readonly reachable: boolean;
  }[];
  /** Every declared `@entity()` as `<domain>:<entityKey>`. */
  readonly entities: ReadonlySet<string>;
  /** Does a slice implementing `domain` serve `METHOD /api/<entityKey>`? */
  readonly serves: (
    domain: string,
    entityKey: string,
    method: string,
  ) => boolean;
  /** The keys of `FLOW_RECIPES`. */
  readonly recipes: ReadonlySet<string>;
  /** Is the permission granted to some role through `ROLE_PERMISSIONS`, wildcards included? */
  readonly granted: (permission: string) => boolean;
  /** `SERVICE_CROSSING_PERMISSIONS`. */
  readonly crossing: ReadonlySet<string>;
  /** Back-office workspace addresses without an id, plus `storefront:<key>`. */
  readonly screens: ReadonlySet<string>;
}

export type CodeKind = 'verb' | 'crud' | 'recipe';

const CRUD_METHODS: Record<string, readonly string[]> = {
  read: ['GET'],
  write: ['POST', 'PUT'],
  delete: ['DELETE'],
};

export const parseId = (id: string) => {
  const [domain = '', entityKey = '', action = '', ...rest] = id.split(':');
  return rest.length === 0 && domain && entityKey && action
    ? { domain, entityKey, action, resource: `${domain}:${entityKey}` }
    : undefined;
};

/** What kind of code, if any, an id resolves to. A recipe wins over CRUD, and a verb over both. */
export const resolveKind = (id: string, world: World): CodeKind | undefined => {
  const parsed = parseId(id);
  if (parsed === undefined) return undefined;
  const { domain, entityKey, action, resource } = parsed;
  if (
    world.useCases.some(
      u => u.resource === resource && u.key === action && u.reachable,
    )
  ) {
    return 'verb';
  }
  if (!world.entities.has(resource)) return undefined;
  if (world.recipes.has(action)) return 'recipe';
  const methods = CRUD_METHODS[action];
  if (methods?.some(method => world.serves(domain, entityKey, method))) {
    return 'crud';
  }
  return undefined;
};

/** Every way the register disagrees with the world. Empty means it agrees. */
export const registerProblems = (
  register: readonly Capability[],
  world: World,
): string[] => {
  const problems: string[] = [];
  const domains = new Map(DOMAINS.map(row => [row.domain, row]));
  const seen = new Set<string>();

  for (const entry of register) {
    const at = `'${entry.id}'`;
    const parsed = parseId(entry.id);

    if (seen.has(entry.id)) problems.push(`${at} is declared twice`);
    seen.add(entry.id);

    if (parsed === undefined) {
      problems.push(`${at} is not <domain>:<entityKey>:<action>`);
      continue;
    }
    if (!(STATUSES as readonly string[]).includes(entry.status)) {
      problems.push(`${at} has an unknown status '${entry.status}'`);
    }
    if (entry.verticals !== 'all') {
      if (entry.verticals.length === 0) {
        problems.push(`${at} lists no vertical: write 'all' or drop the entry`);
      }
      for (const vertical of entry.verticals) {
        if (!(VERTICALS as readonly string[]).includes(vertical)) {
          problems.push(`${at} names the unknown vertical '${vertical}'`);
        }
      }
    }

    const row = domains.get(parsed.domain);
    if (row === undefined) {
      problems.push(`${at} is in domain '${parsed.domain}', not in DOMAINS`);
    } else if (entry.oda !== row.oda && entry.odaOverride === undefined) {
      problems.push(
        `${at} says oda ${String(entry.oda)} but its domain says ${String(row.oda)}, and names no odaOverride`,
      );
    }

    const kind = resolveKind(entry.id, world);

    if (entry.status !== 'implemented') {
      if (kind !== undefined) {
        problems.push(
          `${at} is '${entry.status}' but resolves to code (a ${kind}): the code landed and the entry was not promoted`,
        );
      }
      continue;
    }

    if (kind === undefined) {
      problems.push(
        `${at} is implemented but resolves to no @useCase, served entity action or flow recipe`,
      );
    }
    if (entry.entities[0] !== parsed.resource) {
      problems.push(
        `${at} names '${String(entry.entities[0])}' as its subject, expected '${parsed.resource}'`,
      );
    }
    for (const entity of entry.entities) {
      if (!world.entities.has(entity)) {
        problems.push(
          `${at} names the entity '${entity}', which nothing declares`,
        );
      }
    }
    for (const permission of entry.permissions) {
      if (!world.granted(permission) && !world.crossing.has(permission)) {
        problems.push(
          `${at} names the permission '${permission}', which no role is granted and no crossing carries`,
        );
      }
    }
    for (const screen of entry.screens) {
      if (!world.screens.has(screen)) {
        problems.push(
          `${at} names the screen '${screen}', which nothing serves`,
        );
      }
    }
  }
  return problems;
};

/** Every `@useCase()` and flow recipe the register does not account for. */
export const coverageProblems = (
  register: readonly Capability[],
  world: World,
): string[] => {
  const implemented = register.filter(entry => entry.status === 'implemented');
  const ids = new Set<string>(implemented.map(entry => entry.id));
  const problems: string[] = [];

  for (const useCase of world.useCases) {
    const id = `${useCase.resource}:${useCase.key}`;
    if (!ids.has(id))
      problems.push(`@useCase '${id}' has no implemented entry`);
  }

  const byKind = new Set(
    implemented
      .filter(entry => resolveKind(entry.id, world) === 'recipe')
      .map(entry => parseId(entry.id)?.action),
  );
  const startedByVerb = new Set(
    world.useCases
      .filter(u => u.recipe !== undefined && ids.has(`${u.resource}:${u.key}`))
      .map(u => u.recipe),
  );
  for (const recipe of world.recipes) {
    if (!byKind.has(recipe) && !startedByVerb.has(recipe)) {
      problems.push(`flow recipe '${recipe}' has no implemented entry`);
    }
  }
  return problems;
};
