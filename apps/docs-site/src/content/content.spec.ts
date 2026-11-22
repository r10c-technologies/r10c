import { CAPABILITIES, DOMAINS } from '@r10c/capabilities';
import { SLICES } from '@r10c/slices';

import { siteFor } from '../site';
import { AUDIENCE_FOLDER, AUDIENCES } from './audiences';
import { SERVICES_FOLDER, STORES, STORES_FOLDER } from './catalog';
import { actionTitle, SITE_LOCALES } from './copy';
import { storeMap } from './store-map';
import { capabilitySlugs, partsOf } from './use-cases';

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
