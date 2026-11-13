import {
  NumberInput,
  Stack,
  SubmitButton,
  Text,
} from '@entifix/react-controls/primitives';
import { useId } from 'react';

import { NarrowDisclosure } from '../narrow-disclosure/narrow-disclosure.js';

/** One value of a checkbox facet, its link already computed by the binding. */
export interface FacetOption {
  readonly label: string;
  /** Where choosing it leads: the listing with this value toggled. */
  readonly href: string;
  readonly selected: boolean;
  /**
   * How many results carry it. Absent when the listing could not count, in
   * which case the option shows no number rather than a wrong one.
   */
  readonly count?: number;
}

/** Any number of values at once: brands, sellers. */
export interface CheckboxFacet {
  readonly kind: 'checkbox';
  readonly id: string;
  readonly label: string;
  readonly options: readonly FacetOption[];
}

/** On or off: "in stock only". */
export interface ToggleFacet {
  readonly kind: 'toggle';
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly selected: boolean;
}

/** One bound of a range, as a form field. */
export interface RangeBound {
  /** The query parameter it submits as. */
  readonly name: string;
  readonly label: string;
  readonly value?: string;
}

/**
 * A lower and an upper bound: a price.
 *
 * The one facet that cannot be a link, because the buyer types the numbers. It
 * is a GET form instead, which still needs no script. `action` is the listing,
 * and `hidden` carries every other parameter in force, so submitting a range
 * keeps the rest of the search.
 */
export interface RangeFacet {
  readonly kind: 'range';
  readonly id: string;
  readonly label: string;
  readonly action: string;
  readonly min: RangeBound;
  readonly max: RangeBound;
  readonly hidden: readonly (readonly [string, string])[];
  readonly submitLabel: string;
}

export type FacetDefinition = CheckboxFacet | ToggleFacet | RangeFacet;

export interface FacetPanelProps {
  /** The panel's name, already translated ("Filtrar"). */
  readonly label: string;
  readonly facets: readonly FacetDefinition[];
  /**
   * Folds the panel away on a small screen behind a disclosure reading
   * `summary` ("Filtrar (2)", already translated), so the results come first.
   * Absent, the panel is always open.
   */
  readonly collapsible?: { readonly summary: string };
}

/** A glyph, not copy: hidden from assistive technology, which hears `aria-current`. */
const TICK = '✓';

/**
 * One choice: a link to the listing with it flipped.
 *
 * ⚠️ It draws no checkbox. A box that looks checkable on an element a screen
 * reader announces as a link promised one control and delivered another
 * (a1-19). What is in force is `aria-current="true"` for assistive technology
 * and a tick plus weight for the eye, neither of them a control's shape.
 */
function ChoiceLink({
  label,
  href,
  selected,
  count,
}: {
  readonly label: string;
  readonly href: string;
  readonly selected: boolean;
  readonly count?: number;
}) {
  return (
    <a
      href={href}
      aria-current={selected ? 'true' : undefined}
      className="inline-flex min-h-(--target-min) items-center gap-2xs rounded-sm text-content focus-ring hover:text-primary"
    >
      <span
        aria-hidden="true"
        className={`w-3 shrink-0 text-primary ${selected ? '' : 'invisible'}`}
      >
        {TICK}
      </span>
      <span className={selected ? 'font-semibold' : 'underline'}>{label}</span>
      {count === undefined ? null : (
        <span className="text-step--1 text-content-muted">{count}</span>
      )}
    </a>
  );
}

function Facet({ facet }: { readonly facet: FacetDefinition }) {
  const headingId = useId();

  // A toggle is its own label: a heading above it would say the same words
  // twice. The section keeps the name, so it is still a named region.
  if (facet.kind === 'toggle') {
    return (
      <section aria-label={facet.label}>
        <ChoiceLink
          label={facet.label}
          href={facet.href}
          selected={facet.selected}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId}>
      <Stack gap="2xs">
        <Text id={headingId} weight="semibold" as="h3">
          {facet.label}
        </Text>
        {facet.kind === 'checkbox' ? (
          <ul className="flex flex-col gap-3xs">
            {facet.options.map(option => (
              <li key={option.href}>
                <ChoiceLink {...option} />
              </li>
            ))}
          </ul>
        ) : null}
        {facet.kind === 'range' ? <RangeForm facet={facet} /> : null}
      </Stack>
    </section>
  );
}

function RangeForm({ facet }: { readonly facet: RangeFacet }) {
  // entifix's `NumberInput`, text with a decimal keypad, rather than
  // `type="number"`: a number field swallows a comma decimal typed in `es`,
  // and its spinner steps by a cent. The listing's codec is what reads the
  // bound, and it ignores one it cannot parse.
  const field = (bound: RangeBound) => (
    <label className="text-step--1 flex flex-col gap-3xs text-content-muted">
      {bound.label}
      <NumberInput
        className="w-24"
        autoComplete="off"
        name={bound.name}
        defaultValue={bound.value}
      />
    </label>
  );

  return (
    <form
      method="get"
      action={facet.action}
      className="flex flex-wrap items-end gap-2xs"
    >
      {facet.hidden.map(([name, value]) => (
        <input
          key={`${name}=${value}`}
          type="hidden"
          name={name}
          value={value}
        />
      ))}
      {field(facet.min)}
      {field(facet.max)}
      <SubmitButton variant="secondary">{facet.submitLabel}</SubmitButton>
    </form>
  );
}

/**
 * A listing's filters, described as data and rendered as links.
 *
 * The URL holds the state. Every checkbox value and every toggle is an
 * `<a href>` to the listing with that choice flipped, and a range is a GET
 * form. So the panel runs no script, and a filtered listing is an address that
 * can be shared. The binding derives the definitions and computes every link,
 * and this renders whatever it is handed. A facet fed later from the
 * characteristic dictionary is one more definition.
 */
export function FacetPanel({ label, facets, collapsible }: FacetPanelProps) {
  const labelId = useId();

  const panel = (
    <aside aria-labelledby={labelId}>
      <Stack gap="m">
        <Text id={labelId} weight="semibold" as="h2">
          {label}
        </Text>
        {facets.map(facet => (
          <Facet key={facet.id} facet={facet} />
        ))}
      </Stack>
    </aside>
  );

  if (collapsible === undefined) return panel;

  // A native disclosure, so folding the panel away needs no script either.
  return (
    <NarrowDisclosure summary={collapsible.summary}>{panel}</NarrowDisclosure>
  );
}
