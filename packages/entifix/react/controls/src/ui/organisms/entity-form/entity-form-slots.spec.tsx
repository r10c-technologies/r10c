import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EntityField, readEntityFormFields } from './entity-form-slots';

describe('entity-form slots', () => {
  it('EntityField renders nothing itself — it only carries configuration', () => {
    const { container } = render(<EntityField field="x" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('collects EntityField props and routes everything else to rest', () => {
    const slots = readEntityFormFields([
      <EntityField key="code" field="code" label="Code" />,
      'a bare string, not an element',
      <footer key="foot">unmatched element</footer>,
    ]);

    expect(slots.fields).toEqual([{ field: 'code', label: 'Code' }]);
    // The string (not a valid element) and the footer (unmatched) both fall
    // through to `rest`.
    expect(slots.rest).toHaveLength(2);
  });
});
