import type { ReferencePage } from '@entifix/docs-engine';
import { CAPABILITIES, type Capability } from '@r10c/capabilities';
import { SLICES } from '@r10c/slices';

import { SERVICES_FOLDER } from './catalog';
import { docsCopy, type SiteLocale } from './copy';
import { code, href, link, page, table } from './markdown';
import { capabilityHref } from './use-cases';

/**
 * What a lifecycle step is, and where the site reads it from (#688). A flow
 * is composed from a slip (`flows.ts`); stock, settlement and payout are not
 * flows — they are a ledger, a fold over two events and a run — so their steps
 * name what the registers already hold:
 *
 * - `capability` — an entry of the capability register, `planned` included;
 * - `route` — a route a slice serves (`exposedAPIs`), for a crossing a flow
 *   dispatches that is no use case of its own;
 * - `event` — a message a slice publishes, and the slice that folds it;
 * - `sweep` — what a slice's own timer does.
 *
 * Each is resolved at build: a step naming a capability, a route or an event
 * the registers do not hold fails the build, as an unknown citation does.
 */
export type LifecycleStep =
  | { readonly id: string; readonly capability: string }
  | {
      readonly id: string;
      readonly route: {
        readonly slice: string;
        readonly method: string;
        readonly path: string;
      };
    }
  | {
      readonly id: string;
      readonly event: {
        readonly name: string;
        readonly from: string;
        readonly to?: string;
      };
    }
  | { readonly id: string; readonly sweep: { readonly slice: string } };

export interface Lifecycle {
  readonly id: 'stock' | 'settlement' | 'payout';
  readonly steps: readonly LifecycleStep[];
}

const STOCK = 'stock-management';
const SETTLEMENT = 'settlement-management';

/** The three lifecycles, in the order a sale lives them. */
export const LIFECYCLES: readonly Lifecycle[] = [
  {
    id: 'stock',
    steps: [
      { id: 'receive', capability: `${STOCK}:stock-movement:write` },
      {
        id: 'hold',
        route: { slice: 'stock', method: 'POST', path: '/api/reservation' },
      },
      {
        id: 'convert',
        route: {
          slice: 'stock',
          method: 'POST',
          path: '/api/reservation/:id/conversion',
        },
      },
      {
        id: 'release',
        route: {
          slice: 'stock',
          method: 'DELETE',
          path: '/api/reservation/:id',
        },
      },
      { id: 'expire', sweep: { slice: 'stock' } },
      {
        id: 'restore',
        route: {
          slice: 'stock',
          method: 'POST',
          path: '/api/stock-restoration',
        },
      },
      {
        id: 'announce',
        event: { name: 'stock-item.changed', from: 'stock' },
      },
      { id: 'read', capability: `${STOCK}:stock-item:read` },
    ],
  },
  {
    id: 'settlement',
    steps: [
      { id: 'terms', capability: `${SETTLEMENT}:agreement:write` },
      {
        id: 'placed',
        event: { name: 'order.placed', from: 'order', to: 'settlement' },
      },
      {
        id: 'captured',
        event: { name: 'payment.captured', from: 'payment', to: 'settlement' },
      },
      { id: 'entries', capability: `${SETTLEMENT}:commission-entry:read` },
      {
        id: 'cancelled',
        event: { name: 'order.cancelled', from: 'order', to: 'settlement' },
      },
      {
        id: 'refunded',
        event: { name: 'payment.refunded', from: 'payment', to: 'settlement' },
      },
      {
        id: 'balance',
        route: {
          slice: 'settlement',
          method: 'GET',
          path: '/api/vendor-balance',
        },
      },
    ],
  },
  {
    id: 'payout',
    steps: [
      { id: 'run', capability: `${SETTLEMENT}:settlement-run:write` },
      { id: 'settled', capability: `${SETTLEMENT}:commission-entry:read` },
      { id: 'payout', capability: `${SETTLEMENT}:vendor-payout:read` },
      { id: 'disburse', capability: `${SETTLEMENT}:vendor-payout:disburse` },
    ],
  },
];

const sliceNamed = (name: string) => {
  const slice = SLICES.find(candidate => candidate.name === name);
  if (slice === undefined) {
    throw new Error(`docs-site: no slice '${name}' in the register`);
  }
  return slice;
};

/** `GET|POST /api/x` serves `POST /api/x`. */
const serves = (exposed: readonly string[], method: string, path: string) =>
  exposed.some(line => {
    const [methods = '', served = ''] = line.split(' ');
    return served === path && methods.split('|').includes(method);
  });

export type ResolvedStep =
  | { readonly kind: 'capability'; readonly capability: Capability }
  | {
      readonly kind: 'route';
      readonly slice: string;
      readonly call: string;
    }
  | {
      readonly kind: 'event';
      readonly name: string;
      readonly from: string;
      readonly to?: string;
    }
  | { readonly kind: 'sweep'; readonly slice: string };

/**
 * A step against the registers, or a failure naming it. A step is only as
 * true as what it points at, so nothing here is taken on trust.
 */
export const resolveStep = (
  lifecycle: string,
  step: LifecycleStep,
): ResolvedStep => {
  const where = `docs-site: lifecycle '${lifecycle}' step '${step.id}'`;
  if ('capability' in step) {
    const capability = CAPABILITIES.find(entry => entry.id === step.capability);
    if (capability === undefined) {
      throw new Error(
        `${where} names '${step.capability}', which the register does not hold`,
      );
    }
    return { kind: 'capability', capability };
  }
  if ('route' in step) {
    const { slice, method, path } = step.route;
    if (!serves(sliceNamed(slice).exposedAPIs, method, path)) {
      throw new Error(
        `${where} names '${method} ${path}', which '${slice}' does not serve`,
      );
    }
    return { kind: 'route', slice, call: `${method} ${path}` };
  }
  if ('event' in step) {
    const { name, from, to } = step.event;
    if (!sliceNamed(from).publishedEvents.includes(name)) {
      throw new Error(
        `${where} names '${name}', which '${from}' does not publish`,
      );
    }
    if (
      to !== undefined &&
      !sliceNamed(to).subscriptions.some(entry => entry.event === name)
    ) {
      throw new Error(
        `${where} names '${name}', which '${to}' does not subscribe to`,
      );
    }
    return { kind: 'event', name, from, ...(to === undefined ? {} : { to }) };
  }
  sliceNamed(step.sweep.slice);
  return { kind: 'sweep', slice: step.sweep.slice };
};

interface LifecycleWords {
  readonly title: string;
  readonly description: string;
  readonly steps: Readonly<Record<string, string>>;
}

const wordsOf = (locale: SiteLocale, id: string): LifecycleWords => {
  const all = docsCopy(locale).flows.lifecycles.items as Readonly<
    Record<string, LifecycleWords | undefined>
  >;
  const words = all[id];
  if (words === undefined) {
    throw new Error(
      `docs-site: no flows.lifecycles copy for '${id}' (${locale})`,
    );
  }
  return words;
};

const stepText = (locale: SiteLocale, lifecycle: string, step: string) => {
  const text = wordsOf(locale, lifecycle).steps[step];
  if (text === undefined) {
    throw new Error(
      `docs-site: no flows.lifecycles copy for step '${lifecycle}.${step}' (${locale})`,
    );
  }
  return text;
};

const serviceLink = (locale: SiteLocale, slice: string) =>
  link(slice, href(locale, SERVICES_FOLDER, slice));

/** What a step names, as the table's last two cells. */
const cellsOf = (
  locale: SiteLocale,
  resolved: ResolvedStep,
): readonly [string, string] => {
  const words = docsCopy(locale).flows.lifecycles;
  switch (resolved.kind) {
    case 'capability': {
      const { capability } = resolved;
      const planned = capability.status !== 'implemented';
      return [
        planned
          ? `${words.kinds.capability} — **${words.planned}**`
          : words.kinds.capability,
        link(code(capability.id), capabilityHref(locale, capability)),
      ];
    }
    case 'route':
      return [
        words.kinds.route,
        `${code(resolved.call)} · ${serviceLink(locale, resolved.slice)}`,
      ];
    case 'event':
      return [
        words.kinds.event,
        `${code(resolved.name)} · ${serviceLink(locale, resolved.from)}${resolved.to === undefined ? '' : ` → ${serviceLink(locale, resolved.to)}`}`,
      ];
    case 'sweep':
      return [words.kinds.sweep, serviceLink(locale, resolved.slice)];
  }
};

/** One lifecycle's page: its steps in order, each with what it names. */
export const lifecyclePage = (
  locale: SiteLocale,
  lifecycle: Lifecycle,
  folder: readonly string[],
): ReferencePage => {
  const words = docsCopy(locale).flows.lifecycles;
  const { title, description } = wordsOf(locale, lifecycle.id);
  return {
    path: [...folder, lifecycle.id],
    title,
    description,
    file: 'apps/docs-site/src/content/lifecycles.ts',
    markdown: page(
      table(
        [
          words.columns.order,
          words.columns.step,
          words.columns.kind,
          words.columns.names,
        ],
        lifecycle.steps.map((step, index) => [
          String(index + 1),
          stepText(locale, lifecycle.id, step.id),
          ...cellsOf(locale, resolveStep(lifecycle.id, step)),
        ]),
      ),
    ),
  };
};

/** The index entries, one line per lifecycle. */
export const lifecycleIndex = (locale: SiteLocale, folder: readonly string[]) =>
  LIFECYCLES.map(lifecycle => {
    const { title, description } = wordsOf(locale, lifecycle.id);
    return `- ${link(title, href(locale, ...folder, lifecycle.id))} — ${description}`;
  }).join('\n');
