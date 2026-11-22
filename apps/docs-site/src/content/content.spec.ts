import { CAPABILITIES, DOMAINS } from '@r10c/capabilities';
import { declaredEntityResources, SLICES } from '@r10c/slices';

import { siteFor } from '../site';
import { AUDIENCE_FOLDER, AUDIENCES } from './audiences';
import { SERVICES_FOLDER, STORES, STORES_FOLDER } from './catalog';
import { actionTitle, SITE_LOCALES } from './copy';
import { ENTITY_GRAPH } from './entity-graph';
import { entityMap } from './entity-map';
import { storeMap } from './store-map';
import { capabilitySlugs, MAP_SCHEME, partsOf } from './use-cases';

describe.each(SITE_LOCALES)('the %s tree', locale => {
  const site = siteFor(locale);
  const markdownOf = (slugs: readonly string[]) => {
    const found = site.page(slugs);
    if (found === undefined) throw new Error(`no page at /${slugs.join('/')}`);
    return found.data.input.markdown;
  };

  it('has one page per register entry, titled from the catalog (ADR 0080 §7)', () => {
    for (const capability of CAPABILITIES) {
      const { entityKey, action } = partsOf(capability);
      expect(
        actionTitle(locale, entityKey, action),
        capability.id,
      ).toBeDefined();
      expect(markdownOf(capabilitySlugs(capability))).toContain(
        `\`${capability.id}\``,
      );
    }
  });

  it('drops no entry: every entry sits in a domain of the domain table', () => {
    const domains = new Set(DOMAINS.map(row => row.domain));
    for (const capability of CAPABILITIES) {
      expect(domains, capability.id).toContain(partsOf(capability).domain);
    }
  });

  it('says that what is not built is not built, and links it nowhere', () => {
    for (const capability of CAPABILITIES.filter(
      entry => entry.status !== 'implemented',
    )) {
      expect(markdownOf(capabilitySlugs(capability))).toMatch(/^:::note/);
    }
  });

  it('draws a map on every use case, with each relation as text beside it (#656)', () => {
    for (const capability of CAPABILITIES) {
      const body = markdownOf(capabilitySlugs(capability));
      expect(body).toContain(`(${MAP_SCHEME}${locale}/${capability.id})`);
      for (const { member } of entityMap(capability).edges) {
        expect(body, capability.id).toContain(`\`${member}\``);
      }
    }
  });

  it('opens on four doors, one per audience (Q24)', () => {
    const home = markdownOf([AUDIENCE_FOLDER]);
    for (const audience of AUDIENCES) {
      expect(home).toContain(`/${locale}/${AUDIENCE_FOLDER}/${audience}/`);
      expect(site.page([AUDIENCE_FOLDER, audience])).toBeDefined();
    }
    expect(home).toContain('(/ui/)');
  });

  it('gives every slice a page and every store its one writer and plane (#653)', () => {
    for (const slice of SLICES) {
      expect(
        site.page([SERVICES_FOLDER, slice.name]),
        slice.name,
      ).toBeDefined();
    }
    for (const { store, writer } of STORES) {
      const body = markdownOf([STORES_FOLDER, store.name]);
      expect(body).toContain(`/${locale}/${SERVICES_FOLDER}/${writer.name}/`);
      expect(
        STORES.filter(entry => entry.store.name === store.name),
        `${store.name} has exactly one writer`,
      ).toHaveLength(1);
    }
  });
});

describe('the store map (#657)', () => {
  it('places every store once, and draws every projection between two of them', () => {
    const { placed, projections } = storeMap();
    expect(placed.map(entry => entry.name).sort()).toEqual(
      STORES.map(({ store }) => store.name).sort(),
    );
    const projected = STORES.filter(
      ({ store }) => store.truth !== 'system-of-record',
    );
    expect(projections).toHaveLength(projected.length);
  });
});

describe('the entity map (#656)', () => {
  const mapOf = (...entities: string[]) => entityMap({ entities });

  it('knows every entity the source declares, and no other', () => {
    expect([...ENTITY_GRAPH.keys()].sort()).toEqual(
      [...new Set(declaredEntityResources().values())].sort(),
    );
  });

  it('points only at entities that exist', () => {
    for (const [entity, declared] of ENTITY_GRAPH) {
      for (const { member, target } of declared) {
        if (target !== undefined) {
          expect(ENTITY_GRAPH.has(target), `${entity}.${member}`).toBe(true);
        }
      }
    }
  });

  it('marks every crossing of a store as an id, and nothing else', () => {
    for (const entity of ENTITY_GRAPH.keys()) {
      for (const { kind, member, from, to } of mapOf(entity).edges) {
        expect(kind === 'id', `${entity}.${member}`).toBe(
          from.store !== to.store,
        );
      }
    }
  });

  it('draws a reference, a composition and an id from the metadata', () => {
    const kinds = Object.fromEntries(
      mapOf('order-management:product-order').edges.map(edge => [
        edge.member,
        edge.kind,
      ]),
    );
    expect(kinds).toMatchObject({
      items: 'composition',
      groupId: 'reference',
      vendorId: 'id',
    });
  });

  it('follows a composition into what the part points at', () => {
    expect(
      mapOf('shipping-order-management:shipping-order').edges,
    ).toContainEqual(
      expect.objectContaining({ member: 'lines.offeringId', kind: 'id' }),
    );
  });

  it('draws a tree as a reference to itself', () => {
    const entity = 'catalog-reference:product-category';
    expect(mapOf(entity).edges).toContainEqual(
      expect.objectContaining({
        member: 'parentId',
        kind: 'reference',
        to: expect.objectContaining({ entity }),
      }),
    );
  });

  it('never lays one box over another', () => {
    for (const capability of CAPABILITIES) {
      const spots = entityMap(capability).nodes.map(({ x, y }) => `${x},${y}`);
      expect(new Set(spots).size, capability.id).toBe(spots.length);
    }
  });
});
