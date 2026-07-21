import {
  accessor,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';

import { type BackendRow, makeEntityBackend } from './entity-backend';

/**
 * `id` is deliberately not filterable and `description` is not sortable —
 * those two are what the metadata allowlist is asserted on.
 */
@entity({ key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #code?: string;
  #name?: string;
  #stock = 0;

  @accessor({ type: 'id', label: 'Id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Code' })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({ type: 'string', label: 'Name' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'number', label: 'Stock' })
  get stock(): number {
    return this.#stock;
  }
  set stock(value: number) {
    this.#stock = value;
  }
}

const WIDGETS: BackendRow[] = [
  { id: 'w1', code: 'w-001', name: 'Acme 1', stock: 5 },
  { id: 'w2', code: 'w-002', name: 'Acme 2', stock: 15 },
  { id: 'w3', code: 'w-003', name: 'Globex 1', stock: 25 },
];

const backend = () => makeEntityBackend(Widget, { seed: WIDGETS });

const query = (search: string) => new URLSearchParams(search);

/** The rows of a successful list response. */
const namesOf = (body: unknown) =>
  (body as { data: { items: Array<{ name: string }> } }).data.items.map(
    item => item.name,
  );

const pageOf = (body: unknown) =>
  (body as { data: { items: unknown[]; total: number } }).data;

describe('makeEntityBackend', () => {
  it('serves a page in the entifix envelope', async () => {
    const { status, body } = await backend().list(query(''));

    expect(status).toBe(200);
    expect((body as { meta: { entity: string } }).meta.entity).toBe('widget');
    expect(pageOf(body).total).toBe(3);
    expect(namesOf(body)).toEqual(['Acme 1', 'Acme 2', 'Globex 1']);
  });

  // The point of the fixture: filtering is the real RSQL codec plus the real
  // Mongo filter translation, not a re-implementation that could disagree with
  // the service the `live` profile talks to.
  it('applies an rsql filter through the production pipeline', async () => {
    const { status, body } = await backend().list(
      query(`rsql=${encodeURIComponent('name=like=Acme')}`),
    );

    expect(status).toBe(200);
    expect(namesOf(body)).toEqual(['Acme 1', 'Acme 2']);
    // `total` must reflect the filter, or a pager built on it would lie.
    expect(pageOf(body).total).toBe(2);
  });

  it('combines clauses, sorting and paging the way the service does', async () => {
    const { body } = await backend().list(
      query(
        `rsql=${encodeURIComponent('stock=gt=4')}&sort=-name&page=1&pageSize=2`,
      ),
    );

    expect(namesOf(body)).toEqual(['Globex 1', 'Acme 2']);
    expect(pageOf(body).total).toBe(3);
  });

  it.each([
    ['an unknown member', `rsql=${encodeURIComponent('nope==1')}`],
    ['a member that is not filterable', `rsql=${encodeURIComponent('id==w1')}`],
    ['an unknown sort member', 'sort=nope'],
    ['a malformed expression', `rsql=${encodeURIComponent('name==')}`],
  ])('answers 400 for %s, as the allowlist does', async (_label, search) => {
    const { status, body } = await backend().list(query(search));

    expect(status).toBe(400);
    expect((body as { error: string }).error).toBe('invalid query');
  });

  it('serves a single record with its links', async () => {
    const { status, body } = await backend().get('w2');

    expect(status).toBe(200);
    expect((body as { data: { name: string } }).data.name).toBe('Acme 2');
    expect((body as { meta: { links: unknown[] } }).meta.links).toContainEqual({
      rel: 'self',
      href: '/api/widget/w2',
      method: 'GET',
    });
  });

  it('answers 404 for a record that is not there', async () => {
    const { status, body } = await backend().get('missing');

    expect(status).toBe(404);
    expect(body).toEqual({ message: 'widget not found' });
  });

  it('reseeds, so one fixture can serve several journeys', async () => {
    const instance = backend();
    instance.seed([{ id: 'w9', code: 'w-009', name: 'Wonka', stock: 1 }]);

    expect(instance.rows()).toHaveLength(1);
    expect(namesOf((await instance.list(query(''))).body)).toEqual(['Wonka']);
  });

  // A driver that fails is how the client's error path becomes reachable — and
  // it must arrive as the service's 500, not as a rejected promise.
  it('answers 500 when the driver fails, exposing it for injection', async () => {
    const instance = backend();
    instance.db.failWith(new Error('connection lost'));

    const { status, body } = await instance.list(query(''));

    expect(status).toBe(500);
    expect((body as { error: string }).error).toBe('request failed');
  });

  it('starts empty when no seed is given', async () => {
    const { body } = await makeEntityBackend(Widget).list(query(''));

    expect(pageOf(body).total).toBe(0);
  });
});
