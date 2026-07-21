import axios from 'axios';

/**
 * Every collection response is an `EntifixEnvelope`, so the page sits one level
 * down under `data` — reading `res.data.items` finds `undefined`.
 */
const pageOf = (res: {
  data: { data: { items: Array<Record<string, unknown>>; total: number } };
}) => res.data.data;

const namesOf = (res: {
  data: { data: { items: Array<Record<string, unknown>>; total: number } };
}) => pageOf(res).items.map(item => item['name'] as string);

describe('marketplace-admin-service', () => {
  it('GET /api/health reports ok', async () => {
    const res = await axios.get(`/api/health`);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({
      status: 'ok',
      service: '@r10c/marketplace-admin-service',
    });
  });

  it('GET /api/product returns a paginated page', async () => {
    const res = await axios.get(`/api/product`);

    expect(res.status).toBe(200);
    expect(Array.isArray(pageOf(res).items)).toBe(true);
    expect(typeof pageOf(res).total).toBe('number');
  });
});

/**
 * The query protocol end to end against the real store: `rsql` is parsed and
 * validated against the entity's metadata, then translated into a Mongo query.
 *
 * Assertions are on the *shape* of the result, never on a record count: the
 * catalog seed is not idempotent across restarts, so a store that has booted
 * twice holds every brand twice.
 */
describe('the RSQL query protocol', () => {
  const list = (query: string) =>
    axios.get(`/api/product-brand?${query}`, {
      // 4xx is an assertion subject here, not a transport failure.
      validateStatus: () => true,
    });

  it('narrows a listing by a substring match', async () => {
    // One page wide enough to hold every match, so `total` and the page length
    // are comparable.
    const res = await list(
      `rsql=${encodeURIComponent("name=like='Acme'")}&pageSize=200`,
    );

    expect(res.status).toBe(200);
    expect(namesOf(res).length).toBeGreaterThan(0);
    expect(namesOf(res).every(name => name.includes('Acme'))).toBe(true);
    // `total` must reflect the same filter, or the pager lies about the size.
    expect(pageOf(res).total).toBe(pageOf(res).items.length);
  });

  it('combines two clauses with and', async () => {
    const expression = "name=like='Acme';name!='Acme 1'";
    const res = await list(`rsql=${encodeURIComponent(expression)}`);

    expect(res.status).toBe(200);
    expect(namesOf(res).length).toBeGreaterThan(0);
    expect(namesOf(res).every(name => name.includes('Acme'))).toBe(true);
    expect(namesOf(res)).not.toContain('Acme 1');
  });

  it('combines two clauses with or', async () => {
    const expression = "name=='Acme 1',name=='Globex 1'";
    const res = await list(`rsql=${encodeURIComponent(expression)}`);

    expect(res.status).toBe(200);
    expect([...new Set(namesOf(res))].sort()).toEqual(['Acme 1', 'Globex 1']);
  });

  it('orders a listing by the sort parameter', async () => {
    const ascending = await list('sort=%2Bname&pageSize=200');
    const descending = await list('sort=-name&pageSize=200');

    expect(namesOf(ascending)).toEqual([...namesOf(ascending)].sort());
    expect(namesOf(descending)).toEqual([...namesOf(ascending)].reverse());
  });

  it('applies filtering, sorting and paging together', async () => {
    const res = await list(
      `rsql=${encodeURIComponent("name=like='Acme'")}&sort=-name&page=1&pageSize=1`,
    );

    expect(res.status).toBe(200);
    expect(pageOf(res).items).toHaveLength(1);
    expect(pageOf(res).total).toBeGreaterThan(1);
    // Descending, so page 1 of the `Acme` matches is the last one alphabetically.
    expect(namesOf(res)[0]).toBe('Acme 2');
  });

  // The metadata allowlist is the trust boundary: without it a client could
  // filter or sort on any field in the collection.
  it.each([
    ['an unknown member', `rsql=${encodeURIComponent('nope==1')}`],
    ['a member that is not filterable', `rsql=${encodeURIComponent('id==1')}`],
    ['an unknown sort member', 'sort=nope'],
  ])('rejects %s with a 400', async (_label, query) => {
    const res = await list(query);

    expect(res.status).toBe(400);
    expect(res.data.error).toBe('invalid query');
  });

  it('rejects a malformed expression with a 400', async () => {
    const res = await list(`rsql=${encodeURIComponent('name==')}`);

    expect(res.status).toBe(400);
  });
});
