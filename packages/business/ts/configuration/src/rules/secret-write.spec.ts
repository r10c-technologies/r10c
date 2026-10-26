import { describe, expect, it } from 'vitest';

import { decideSecretWrite } from './secret-write.js';

describe('decideSecretWrite', () => {
  it('keeps a stored credential when the form sent the field blank', () => {
    expect(
      decideSecretWrite(
        { isSecret: true, value: 'kept' },
        { isSecret: true, value: '' },
      ),
    ).toEqual({ _tag: 'accept', value: 'kept' });
    expect(decideSecretWrite({ isSecret: true, value: 'kept' }, {})).toEqual({
      _tag: 'accept',
      value: 'kept',
    });
  });

  it('refuses to clear the secret flag without a new value', () => {
    expect(
      decideSecretWrite({ isSecret: true, value: 'kept' }, { isSecret: false }),
    ).toEqual({ _tag: 'refuse', code: 'secretRequiresValue' });
  });

  it('takes a new value, and anything at all for a row that was never secret', () => {
    expect(
      decideSecretWrite(
        { isSecret: true, value: 'old' },
        { isSecret: false, value: 'new' },
      ),
    ).toEqual({ _tag: 'accept', value: 'new' });
    expect(
      decideSecretWrite({ isSecret: false, value: 'a' }, { value: '' }),
    ).toEqual({
      _tag: 'accept',
      value: '',
    });
    expect(decideSecretWrite(undefined, { value: 'first' })).toEqual({
      _tag: 'accept',
      value: 'first',
    });
  });
});
