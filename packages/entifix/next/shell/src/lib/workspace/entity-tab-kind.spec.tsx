import { describe, expect, it } from 'vitest';

import { entityTabKind, type EntityTabScreens } from './entity-tab-kind';

const screens: EntityTabScreens = {
  lists: { widget: { titleKey: 'entity:widget.plural', render: () => 'list' } },
  records: {
    widget: {
      labelKey: 'entity:widget.label',
      render: id => `record ${id}`,
    },
  },
};

const translate = (key: string) => `t(${key})`;

describe('entityTabKind', () => {
  it('takes its kind from the screen type, so two types are two kinds', () => {
    expect(entityTabKind('master', screens).kind).toBe('master');
    expect(entityTabKind('operation', screens).kind).toBe('operation');
  });

  describe('a list address', () => {
    const kind = entityTabKind('operation', screens);

    it('matches, titles from the plural and renders the list', () => {
      const addr = kind.match('widget');

      expect(addr).toEqual({ key: 'widget' });
      expect(kind.title(addr!, translate)).toBe('t(entity:widget.plural)');
      expect(kind.render(addr!)).toBe('list');
      expect(kind.toParam(addr!)).toBe('widget');
    });
  });

  describe('a record address', () => {
    const kind = entityTabKind('operation', screens);

    it('matches, titles from the label and renders the record', () => {
      const addr = kind.match('widget:abc');

      expect(addr).toEqual({ key: 'widget', id: 'abc' });
      expect(kind.title(addr!, translate)).toBe('t(entity:widget.label) #abc');
      expect(kind.render(addr!)).toBe('record abc');
      expect(kind.toParam(addr!)).toBe('widget:abc');
    });
  });

  describe('what it refuses', () => {
    const kind = entityTabKind('operation', screens);

    it('refuses a key it does not know', () => {
      expect(kind.match('absent')).toBeNull();
      expect(kind.match('absent:abc')).toBeNull();
    });

    it('refuses a malformed payload rather than treating an empty id as present', () => {
      // `widget:` parsing as `{ key: 'widget', id: '' }` would resolve to the
      // record editor for a record with no id.
      expect(kind.match('widget:')).toBeNull();
      expect(kind.match('')).toBeNull();
    });

    it('refuses a record address for a screen that offers only a list', () => {
      const listOnly = entityTabKind('operation', {
        lists: screens.lists,
        records: {},
      });

      expect(listOnly.match('widget')).toEqual({ key: 'widget' });
      expect(listOnly.match('widget:abc')).toBeNull();
    });
  });
});
