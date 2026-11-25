import { describe, expect, it } from 'vitest';

import { entityDeclarations } from './source-scan.js';

describe('entityDeclarations', () => {
  it('reads options a comment closes a parenthesis in, which a pattern stopped at', () => {
    const text = `
@entity({
  domain: 'catalog',
  key: 'version',
  // Frozen once released (ADR 0079 §1) — and a lone ")" here too.
  writableWhen: { member: 'status', in: [...Editable] },
  readOnlyReasonKey: 'entity:version.readOnly',
})
export class Version implements Entity {}
`;

    expect(entityDeclarations(text)).toEqual([
      expect.objectContaining({
        className: 'Version',
        domain: 'catalog',
        key: 'version',
        options: expect.stringContaining('readOnlyReasonKey'),
      }),
    ]);
  });

  it('skips brackets inside strings and block comments', () => {
    const text = `
@entity({ key: 'a', labelKey: 'x)(', /* ) */ domain: 'd' })
abstract class A {}
@entity()
class B {}
`;

    const [a, b] = entityDeclarations(text);
    expect(a).toMatchObject({ className: 'A', key: 'a', domain: 'd' });
    expect(b).toMatchObject({ className: 'B', options: '' });
    expect(b).not.toHaveProperty('key');
  });

  it('names no class when the decorator decorates none, and reads to the end of an unclosed one', () => {
    expect(entityDeclarations(`@entity({ key: 'k' })\nconst x = 1;`)).toEqual([
      expect.not.objectContaining({ className: expect.anything() }),
    ]);
    expect(entityDeclarations(`@entity({ key: 'k' // open`)).toHaveLength(1);
    expect(entityDeclarations(`@entity({ /* open`)).toHaveLength(1);
  });
});
