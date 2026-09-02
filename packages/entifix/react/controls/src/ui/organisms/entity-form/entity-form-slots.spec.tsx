import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  EntityActions,
  EntityField,
  readEntityFormFields,
} from './entity-form-slots';

describe('entity-form slots', () => {
  it('EntityField renders nothing itself — it only carries configuration', () => {
    const { container } = render(<EntityField field="x" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('EntityActions renders nothing itself either', () => {
    const { container } = render(
      <EntityActions>
        <span>{'x'}</span>
      </EntityActions>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  /** The footer is the default: most bespoke actions sit beside Save. */
  it('routes actions by placement, defaulting to the footer', () => {
    const slots = readEntityFormFields([
      <EntityActions key="h" placement="header">
        <span>{'header'}</span>
      </EntityActions>,
      <EntityActions key="f">
        <span>{'footer'}</span>
      </EntityActions>,
    ]);

    expect(slots.headerActions).toHaveLength(1);
    expect(slots.footerActions).toHaveLength(1);
    expect(slots.rest).toHaveLength(0);
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
