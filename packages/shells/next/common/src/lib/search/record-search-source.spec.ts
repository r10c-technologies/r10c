import {
  accessor,
  EntifixLogicError,
  type Entity,
  entity,
  type EntityId,
  makeEntityPageEnvelope,
} from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import type { RecordSearchOption } from './record-search.types';
import { defineRecordSearchSource } from './record-search-source';

/**
 * A local fixture rather than a business entity, so this spec is a test of the
 * declaration rules and not of whichever catalog entity happens to satisfy them
 * today.
 */
@entity({ key: 'thing', domain: 'testing' })
class Thing implements Entity {
  #id?: EntityId;
  #name?: string;
  #code?: string;
  #secret?: string;
  #status?: string;
  #unsortable?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', alias: 'display_name' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'string' })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({ type: 'string', filterable: false })
  get secret(): string | undefined {
    return this.#secret;
  }
  set secret(value: string | undefined) {
    this.#secret = value;
  }

  @accessor({ type: 'enum', enumValues: ['open', 'closed'] })
  get status(): string | undefined {
    return this.#status;
  }
  set status(value: string | undefined) {
    this.#status = value;
  }

  @accessor({ type: 'string', sortable: false })
  get unsortable(): string | undefined {
    return this.#unsortable;
  }
  set unsortable(value: string | undefined) {
    this.#unsortable = value;
  }
}

const define = (over: Record<string, unknown> = {}) =>
  defineRecordSearchSource({
    entityConstructor: Thing,
    baseUrl: 'http://things.test',
    searchProperty: 'name',
    labelProperty: 'name',
    labelKey: 'entity:thing.plural',
    href: id => `/things/${id}`,
    ...over,
  });

/** The options a source read out of one page, or an empty list if unreadable. */
const optionsOf = (
  source: ReturnType<typeof define>,
  body: unknown,
): RecordSearchOption[] => source.read(body)?.items ?? [];

const aPage = (
  rows: ReadonlyArray<Record<string, unknown>>,
  total = rows.length,
) =>
  makeEntityPageEnvelope(Thing, {
    items: rows as unknown as Thing[],
    total,
    request: {},
  });

describe('defineRecordSearchSource', () => {
  describe('identity', () => {
    it('defaults the key to the entity wire name', () => {
      expect(define()).toMatchObject({
        key: 'thing',
        entity: 'thing',
        labelKey: 'entity:thing.plural',
      });
    });

    it('lets a host override the key', () => {
      expect(define({ key: 'my-things' }).key).toBe('my-things');
    });
  });

  describe('the upstream url', () => {
    it('carries the term, the sort, and the page size', () => {
      // The member's wire key, not its accessor name: `name` is aliased to
      // `display_name`, and the allowlist is keyed on both — but what the
      // service filters on is the column.
      expect(define().url('Acme', 5)).toBe(
        'http://things.test/api/thing?rsql=display_name%3Dlike%3DAcme&sort=%2Bdisplay_name&page=1&pageSize=5',
      );
    });

    // Not tidiness: hand-building the expression would split this term into two
    // comparisons at the comma and search for something nobody typed.
    it('quotes a term carrying reserved characters', () => {
      const rsql = new URL(define().url("Acme, Inc.'s", 5)).searchParams.get(
        'rsql',
      );

      expect(rsql).toBe("display_name=like='Acme, Inc.\\'s'");
    });
  });

  describe('rejecting a declaration the metadata cannot honour', () => {
    it('refuses a search member the entity does not declare', () => {
      expect(() => define({ searchProperty: 'nope' })).toThrow(
        EntifixLogicError,
      );
    });

    it('refuses a search member that is not filterable', () => {
      // The flag is the server-side RSQL allowlist, so this would be a `400`
      // rendered as "there are no things".
      expect(() => define({ searchProperty: 'secret' })).toThrow(
        /not filterable/,
      );
    });

    it('refuses a search member that is not a string', () => {
      // An enum passes the filterable check and is still permanently broken: a
      // partial term is not a valid value, so every keystroke answers `400`.
      expect(() => define({ searchProperty: 'status' })).toThrow(
        /not a valid value/,
      );
    });

    it('refuses a label member the entity does not declare', () => {
      expect(() => define({ labelProperty: 'nope' })).toThrow(
        /no such label member/,
      );
    });

    it('refuses a label member that is not sortable', () => {
      expect(() => define({ labelProperty: 'unsortable' })).toThrow(
        /not sortable/,
      );
    });

    it('refuses a sublabel member the entity does not declare', () => {
      expect(() => define({ sublabelProperty: 'nope' })).toThrow(
        /no such sublabel member/,
      );
    });

    it('names the entity and the member on the error', () => {
      try {
        define({ searchProperty: 'secret' });
        expect.unreachable();
      } catch (error) {
        expect((error as EntifixLogicError).message).toContain('Thing');
        expect((error as EntifixLogicError).message).toContain('secret');
      }
    });
  });

  describe('reading an answer', () => {
    it('maps a page to options', () => {
      const source = define({ sublabelProperty: 'code' });

      expect(
        source.read(aPage([{ id: 't-1', name: 'Acme', code: 'C-1' }], 7)),
      ).toEqual({
        items: [
          {
            id: 't-1',
            label: 'Acme',
            sublabel: 'C-1',
            entity: 'thing',
            href: '/things/t-1',
          },
        ],
        total: 7,
      });
    });

    it('omits the sublabel when the source declared none', () => {
      const [option] = optionsOf(
        define(),
        aPage([{ id: 't-1', name: 'Acme', code: 'C-1' }]),
      );

      expect(option).not.toHaveProperty('sublabel');
    });

    it('omits the sublabel when the record has no value for it', () => {
      const [option] = optionsOf(
        define({ sublabelProperty: 'code' }),
        aPage([{ id: 't-1', name: 'Acme' }]),
      );

      expect(option).not.toHaveProperty('sublabel');
    });

    // An unnamed record still has to be distinguishable from the one above it.
    it.each([
      ['null', null],
      ['blank', ''],
    ])('falls back to the id for a %s label', (_case, value) => {
      const [option] = optionsOf(define(), aPage([{ id: 't-1', name: value }]));

      expect(option?.label).toBe('t-1');
    });

    it('drops a record with no id, since it cannot be routed to', () => {
      expect(define().read(aPage([{ name: 'Acme' }]))?.items).toEqual(
        [],
      );
    });

    it.each([
      ['a body that is not an envelope', {}],
      ['an envelope of the wrong type', { meta: { type: 'entity' }, data: {} }],
      ['null', null],
      ['a string', 'nope'],
    ])('reads %s as unreadable', (_case, body) => {
      expect(define().read(body)).toBeUndefined();
    });
  });
});
