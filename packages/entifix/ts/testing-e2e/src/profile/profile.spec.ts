import {
  DEFAULT_E2E_PROFILE,
  isLiveProfile,
  isMockProfile,
  requireLiveUrl,
  resolveE2eProfile,
} from './profile';

describe('resolveE2eProfile', () => {
  it('defaults to mock so a run needs no infrastructure', () => {
    expect(resolveE2eProfile({})).toBe('mock');
    expect(DEFAULT_E2E_PROFILE).toBe('mock');
  });

  // An empty variable is what an unset shell export looks like.
  it('treats an empty value as unset', () => {
    expect(resolveE2eProfile({ E2E_PROFILE: '' })).toBe('mock');
  });

  it.each(['mock', 'live'])('accepts %s', profile => {
    expect(resolveE2eProfile({ E2E_PROFILE: profile })).toBe(profile);
  });

  // Falling back to mock here would run the hermetic suite while the operator
  // believed they were testing a deployment.
  it('rejects an unknown profile rather than falling back', () => {
    expect(() => resolveE2eProfile({ E2E_PROFILE: 'live-ish' })).toThrow(
      /Unknown E2E_PROFILE "live-ish"\. Expected one of: mock, live\./,
    );
  });

  it('reads process.env when no environment is passed', () => {
    expect(resolveE2eProfile()).toBe(resolveE2eProfile(process.env));
  });
});

describe('the profile predicates', () => {
  it('agree with the resolved profile', () => {
    expect(isMockProfile({ E2E_PROFILE: 'mock' })).toBe(true);
    expect(isLiveProfile({ E2E_PROFILE: 'mock' })).toBe(false);
    expect(isMockProfile({ E2E_PROFILE: 'live' })).toBe(false);
    expect(isLiveProfile({ E2E_PROFILE: 'live' })).toBe(true);
  });

  it('default to the ambient environment', () => {
    expect(isMockProfile()).toBe(!isLiveProfile());
  });
});

describe('requireLiveUrl', () => {
  it('returns the configured url without its trailing slashes', () => {
    expect(
      requireLiveUrl('SERVICE_URL', { SERVICE_URL: 'http://localhost:3101//' }),
    ).toBe('http://localhost:3101');
  });

  it.each([
    ['unset', {}],
    ['empty', { SERVICE_URL: '' }],
  ])('throws when the variable is %s', (_label, env) => {
    expect(() => requireLiveUrl('SERVICE_URL', env)).toThrow(
      /E2E_PROFILE=live requires SERVICE_URL to point at the running service/,
    );
  });

  it('reads process.env when no environment is passed', () => {
    expect(() => requireLiveUrl('R10C_DEFINITELY_UNSET_URL')).toThrow();
  });
});
